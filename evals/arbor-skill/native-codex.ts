// scry-ignore-file compact-files: native startup, cancellation, RPC replies and usage share one owned session state machine.
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type {
	NativeDriver,
	NativeRequest,
	NativeSession,
	NativeUpdate,
} from "./native-adapter";
import type { Json } from "./probe";
import { type Allowance, validateAllowance } from "./probe-affordability";

/** Admission is a reservation, never a Codex billing ceiling. No credentials are read or copied. */
export interface NativeCodexOptions {
	allowance: Allowance;
	/** Native executable override, also used by free subprocess transport fixtures. */
	argv?: string[];
	/** Explicitly configured native auth/config home. Defaults to the probe's private HOME/.codex. */
	codexHome?: string;
}

/** Compose with nativeAdapter(nativeCodex({ allowance }), { source, mode }) in #382. */
export function nativeCodex(opts: NativeCodexOptions): NativeDriver {
	validateAllowance(opts.allowance);
	const allowance = { ...opts.allowance };
	const argv = [
		...(opts.argv ?? ["codex", "app-server", "--listen", "stdio://"]),
	];
	if (!argv.length) {
		throw new Error("Codex argv is empty");
	}
	if (opts.codexHome && !opts.codexHome.startsWith("/")) {
		throw new Error("codexHome must be absolute");
	}
	return {
		id: "native-codex",
		version: "1",
		config: {
			argv,
			allowance,
			codexHome: opts.codexHome ?? null,
			protocol: "app-server-0.156.0",
			usage: "reported cumulative tokens; USD and billing completeness unknown",
		},
		limits: { tokens: "monitored", costUsd: "unavailable" },
		quote: (_probe, model) => (model ? { ...allowance } : null),
		create: (request) => new CodexSession(request, argv, opts.codexHome),
	};
}

type ObjectValue = { [key: string]: Json };
function object(value: Json | undefined): ObjectValue {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value
		: {};
}
function array(value: Json | undefined): Json[] {
	return Array.isArray(value) ? value : [];
}
function requiredString(value: Json | undefined, name: string): string {
	if (typeof value !== "string" || !value) {
		throw new Error(`Codex missing ${name}`);
	}
	return value;
}

class CodexSession implements NativeSession {
	private child?: ChildProcessWithoutNullStreams;
	private closed?: Promise<void>;
	private sequence = 0;
	private pending = new Map<
		number,
		{
			resolve: (value: Json) => void;
			reject: (error: Error) => void;
			method: string;
		}
	>();
	private emit: (update: NativeUpdate) => void = () => {};
	private thread?: string;
	private turn?: string;
	private cancelled = false;
	private disposed?: Promise<void>;
	private interrupt?: Promise<void>;
	private killTimer?: ReturnType<typeof setTimeout>;
	private tokens: number | null = null;
	private replies = new Map<string, string>();
	private completed = Promise.withResolvers<void>();
	private terminal = false;
	private prompted = false;
	private failure?: Error;
	private killed = false;

	constructor(
		private request: NativeRequest,
		private argv: string[],
		private codexHome?: string,
	) {
		// May reject during startup, before run begins waiting on the turn.
		void this.completed.promise.catch(() => {});
	}
	private unsupported(detail: string) {
		this.request.context.evidence.termination = "unsupported";
		this.request.context.evidence.detail = detail;
	}
	async run(emit: (update: NativeUpdate) => void) {
		this.emit = emit;
		const { context, model, tools, skill } = this.request;
		if (this.cancelled) {
			return;
		}
		if (process.platform === "win32") {
			return this.unsupported(
				"Codex eval process-group cleanup requires a Unix host",
			);
		}
		if (!model) {
			return this.unsupported("Codex requires an explicit model");
		}
		// A shell grants arbitrary local commands, not an executable allowlist. Narrow
		// arbor/git-only and tool-free profiles cannot be enforced by this protocol.
		if (
			!tools.includes("read") ||
			!tools.includes("write") ||
			!tools.some((tool) => tool === "shell" || tool === "exec") ||
			tools.some((tool) => !["shell", "exec", "read", "write"].includes(tool))
		) {
			return this.unsupported(
				"Codex supports the broad local shell/exec + read + write profile only; no exact executable or tool-free allowlist",
			);
		}
		if (context.probe.stop.kind !== "reply") {
			return this.unsupported("Codex cannot certify command/read event stops");
		}
		const source = await realpath(skill.source);
		const skillPath = join(source, "SKILL.md");
		const cwd = await realpath(context.isolation.repository);
		context.signal.throwIfAborted();
		if (this.cancelled) {
			return;
		}
		if (!this.codexHome) {
			await mkdir(
				join(context.env.HOME ?? context.isolation.repository, ".codex"),
				{ recursive: true },
			);
		}
		context.signal.throwIfAborted();
		if (this.cancelled) {
			return;
		}
		this.start();
		try {
			const initialized = object(
				await this.rpc("initialize", {
					clientInfo: { name: "arbor_native_eval", version: "1" },
					capabilities: { experimentalApi: true },
				}),
			);
			if (
				typeof initialized.userAgent !== "string" ||
				!initialized.userAgent.includes("/0.156.0 ")
			) {
				return this.unsupported(
					"Codex protocol version not verified; requires 0.156.0",
				);
			}
			this.send({ method: "initialized" });
			const account = object(
				await this.rpc("account/read", { refreshToken: false }),
			);
			if (
				typeof object(account.account).type !== "string" &&
				account.requiresOpenaiAuth !== false
			) {
				return this.unsupported(
					"Codex native authentication is unavailable in the configured home; credentials are not copied",
				);
			}
			// Read native config only to disable inherited MCP servers before thread creation.
			const config = object(
				object(await this.rpc("config/read", { includeLayers: false, cwd }))
					.config,
			);
			const overrides: ObjectValue = {
				"features.apps": false,
				"features.multi_agent": false,
				"features.hooks": false,
				"features.remote_plugin": false,
				"features.skill_mcp_dependency_install": false,
				"features.shell_tool": true,
				web_search: "disabled",
				"sandbox_workspace_write.network_access": false,
				"sandbox_workspace_write.writable_roots": [],
				"sandbox_workspace_write.exclude_tmpdir_env_var": true,
				"sandbox_workspace_write.exclude_slash_tmp": true,
			};
			for (const feature of [
				"browser_use",
				"browser_use_external",
				"computer_use",
				"image_generation",
				"in_app_browser",
				"in_app_local_automation",
				"plugins",
				"recommended_plugins",
				"tool_suggest",
				"multi_agent_v2",
				"code_mode",
				"code_mode_host",
				"realtime_conversation",
				"auth_elicitation",
				"shell_snapshot",
				"goals",
				"memories",
				"workspace_dependencies",
				"step_model_switching",
			]) {
				overrides[`features.${feature}`] = false;
			}
			for (const name of Object.keys(object(config.mcp_servers))) {
				overrides[`mcp_servers.${JSON.stringify(name)}.enabled`] = false;
			}
			for (const name of Object.keys(object(config.plugins))) {
				overrides[`plugins.${JSON.stringify(name)}.enabled`] = false;
			}
			await this.rpc("skills/extraRoots/set", { extraRoots: [source] });
			const skills = object(
				await this.rpc("skills/list", { cwds: [cwd], forceReload: true }),
			);
			const selected = array(skills.data)
				.flatMap((entry) => array(object(entry).skills))
				.map(object)
				.find((entry) => entry.path === skillPath && entry.enabled === true);
			if (!selected) {
				return this.unsupported(
					"Codex did not discover the selected native skill source",
				);
			}
			const started = object(
				await this.rpc("thread/start", {
					model,
					cwd,
					approvalPolicy: "never",
					approvalsReviewer: "user",
					sandbox: "workspace-write",
					config: overrides,
					ephemeral: true,
					allowProviderModelFallback: false,
				}),
			);
			this.thread = requiredString(object(started.thread).id, "thread id");
			const sandbox = object(started.sandbox);
			if (
				started.model !== model ||
				started.cwd !== cwd ||
				started.approvalPolicy !== "never" ||
				started.approvalsReviewer !== "user" ||
				sandbox.type !== "workspaceWrite" ||
				sandbox.networkAccess !== false ||
				array(sandbox.writableRoots).some((root) => root !== cwd) ||
				sandbox.excludeTmpdirEnvVar !== true ||
				sandbox.excludeSlashTmp !== true
			) {
				return this.unsupported(
					"Codex did not confirm the requested model/cwd/permission policy",
				);
			}
			context.runtime.codex = {
				model,
				instructionSources: started.instructionSources ?? [],
				skill: skillPath,
				permissions: sandbox,
				tokenControl: "monitored; in-flight overshoot possible",
				costControl: "unavailable",
			};
			context.signal.throwIfAborted();
			if (this.cancelled) {
				return;
			}
			const input: Json[] = [
				{ type: "text", text: context.probe.input.text, text_elements: [] },
			];
			if (skill.mode === "explicit") {
				input.push({
					type: "skill",
					name: requiredString(selected.name, "skill name"),
					path: skillPath,
				});
			}
			this.prompted = true;
			const result = object(
				await this.rpc("turn/start", { threadId: this.thread, input }),
			);
			this.turn = requiredString(object(result.turn).id, "turn id");
			if (this.cancelled) {
				this.requestInterrupt();
			}
			await this.completed.promise;
		} catch (error) {
			if (
				!this.prompted &&
				error instanceof Error &&
				(error.cause === "codex-rpc" ||
					(error as NodeJS.ErrnoException).code === "ENOENT")
			) {
				this.unsupported(`Codex startup unavailable: ${error.message}`);
			} else {
				throw error;
			}
		} finally {
			// Usage completeness remains false: the protocol supplies no dollar total or
			// certificate accounting for every billed retry/tool/child. Never refund it.
			emit({ kind: "usage", tokens: this.tokens, costUsd: null, final: false });
		}
	}
	private start() {
		const { context } = this.request;
		this.child = spawn(this.argv[0] as string, this.argv.slice(1), {
			cwd: context.isolation.repository,
			env: {
				...context.env,
				CODEX_HOME:
					this.codexHome ??
					join(context.env.HOME ?? context.isolation.repository, ".codex"),
			},
			detached: true,
			stdio: "pipe",
		});
		const child = this.child;
		const lines = createInterface({ input: child.stdout });
		lines.on("line", (line) => {
			try {
				this.receive(object(JSON.parse(line) as Json));
			} catch (error) {
				this.fail(error instanceof Error ? error : new Error(String(error)));
				this.kill();
			}
		});
		// Drain stderr without persisting auth/provider diagnostics that can contain secrets.
		child.stderr.resume();
		child.stdin.on("error", (error) => this.fail(error));
		child.once("error", (error) => this.fail(error));
		this.closed = new Promise((done) =>
			child.once("close", (code) => {
				lines.close();
				this.fail(new Error(`Codex transport closed (${code})`));
				done();
			}),
		);
	}
	private send(value: ObjectValue) {
		if (!this.child || this.failure) {
			throw this.failure ?? new Error("Codex transport not started");
		}
		this.child.stdin.write(`${JSON.stringify(value)}\n`);
	}
	private rpc(method: string, params: ObjectValue): Promise<Json> {
		if (this.failure) {
			return Promise.reject(this.failure);
		}
		const id = ++this.sequence;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject, method });
			try {
				this.send({ id, method, params });
			} catch (error) {
				this.pending.delete(id);
				reject(error);
			}
		});
	}
	private receive(message: ObjectValue) {
		if (typeof message.method !== "string") {
			const pending =
				typeof message.id === "number"
					? this.pending.get(message.id)
					: undefined;
			if (!pending) {
				return;
			}
			this.pending.delete(message.id as number);
			if (message.error) {
				pending.reject(
					new Error(
						`Codex ${pending.method} failed (${object(message.error).code ?? "unknown"}); check native authentication, configuration and protocol support`,
						{ cause: "codex-rpc" },
					),
				);
			} else {
				pending.resolve(message.result ?? null);
			}
			return;
		}
		const params = object(message.params);
		if (message.id !== undefined) {
			// No automatic escalation, interactive input, external auth refresh or dynamic tools.
			if (
				message.method === "item/commandExecution/requestApproval" ||
				message.method === "item/fileChange/requestApproval"
			) {
				this.send({ id: message.id, result: { decision: "decline" } });
			} else {
				this.send({
					id: message.id,
					error: { code: -32601, message: "Unsupported native eval request" },
				});
			}
			this.emit({
				kind: "trace",
				value: { method: message.method, denied: true },
			});
			return;
		}
		// Keep native tool text in traces, never convert it into executed argv/read evidence.
		if (!message.method.startsWith("account/")) {
			this.emit({ kind: "trace", value: message });
		}
		if (params.threadId !== this.thread || !this.thread) {
			return;
		}
		if (message.method === "turn/started") {
			this.turn = requiredString(object(params.turn).id, "turn id");
		}
		if (
			this.turn &&
			typeof params.turnId === "string" &&
			params.turnId !== this.turn
		) {
			return;
		}
		if (message.method === "thread/tokenUsage/updated") {
			const total = object(object(params.tokenUsage).total).totalTokens;
			if (
				typeof total !== "number" ||
				!Number.isSafeInteger(total) ||
				total < 0 ||
				(this.tokens !== null && total < this.tokens)
			) {
				throw new Error("Invalid cumulative Codex token usage");
			}
			this.tokens = total;
			this.emit({ kind: "usage", tokens: total, costUsd: null, final: false });
			if (total >= this.request.allowance.tokens) {
				this.request.context.evidence.termination = "bound";
				this.request.context.evidence.detail =
					"Codex monitored token allowance reached; in-flight overshoot possible";
				this.cancel();
			}
		}
		if (message.method === "item/completed") {
			const item = object(params.item);
			if (item.type === "agentMessage" && item.phase === "final_answer") {
				this.replies.set(
					requiredString(item.id, "item id"),
					requiredString(item.text, "reply text"),
				);
			}
		}
		if (message.method === "turn/completed") {
			this.terminal = true;
			const status = object(params.turn).status;
			this.emit({
				kind: "usage",
				tokens: this.tokens,
				costUsd: null,
				final: false,
			});
			if (status === "completed" && !this.cancelled) {
				if (!this.replies.size) {
					this.completed.reject(
						new Error("Codex completed without an identifiable final answer"),
					);
					return;
				}
				this.emit({
					kind: "reply",
					text: [...this.replies.values()].join("\n"),
				});
			} else if (status === "interrupted") {
				this.request.context.evidence.termination = "bound";
				this.request.context.evidence.detail ??= "Codex turn interrupted";
			} else if (status !== "completed") {
				this.completed.reject(new Error(`Codex turn ${String(status)}`));
				return;
			}
			this.completed.resolve();
		}
	}
	private fail(error: Error) {
		this.failure ??= error;
		for (const pending of this.pending.values()) {
			pending.reject(error);
		}
		this.pending.clear();
		if (!this.terminal) {
			this.completed.reject(error);
		}
	}
	private kill() {
		if (this.killed) {
			return;
		}
		this.killed = true;
		if (this.child?.pid) {
			try {
				process.kill(-this.child.pid, "SIGKILL");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
					throw error;
				}
			}
		}
	}
	private async awaitGroupExit() {
		const pid = this.child?.pid;
		if (!pid) {
			return;
		}
		for (let attempt = 0; attempt < 50; attempt++) {
			let alive = false;
			for (const target of [pid, -pid]) {
				try {
					process.kill(target, 0);
					alive = true;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
						throw error;
					}
				}
			}
			if (!alive) {
				return;
			}
			await new Promise<void>((done) => setTimeout(done, 10));
		}
		throw new Error("Codex process group did not exit after cleanup");
	}

	private requestInterrupt() {
		if (!this.thread || !this.turn || this.terminal || this.interrupt) {
			return;
		}
		this.interrupt = this.rpc("turn/interrupt", {
			threadId: this.thread,
			turnId: this.turn,
		}).then(
			() => {},
			() => {},
		);
	}
	cancel() {
		if (this.cancelled) {
			return;
		}
		this.cancelled = true;
		this.requestInterrupt();
		if (this.child) {
			this.killTimer = setTimeout(() => this.kill(), 150);
		}
	}
	dispose(): Promise<void> {
		this.disposed ??= (async () => {
			this.cancel();
			// Interrupt first, but never wait indefinitely for an uncooperative server.
			if (this.child && this.turn && !this.terminal) {
				await Promise.race([
					this.completed.promise.catch(() => {}),
					new Promise<void>((done) => setTimeout(done, 175)),
				]);
			}
			let terminalCleanupError: unknown;
			if (this.thread && !this.failure) {
				let timer: ReturnType<typeof setTimeout> | undefined;
				try {
					await Promise.race([
						this.rpc("thread/backgroundTerminals/clean", {
							threadId: this.thread,
						}),
						new Promise<never>((_resolve, reject) => {
							timer = setTimeout(
								() => reject(new Error("Codex terminal cleanup timed out")),
								100,
							);
						}),
					]);
				} catch (error) {
					terminalCleanupError = error;
				} finally {
					if (timer) {
						clearTimeout(timer);
					}
				}
			}
			this.kill();
			await this.closed;
			await this.awaitGroupExit();
			await this.interrupt;
			if (this.killTimer) {
				clearTimeout(this.killTimer);
			}
			if (terminalCleanupError) {
				throw terminalCleanupError;
			}
		})();
		return this.disposed;
	}
}
