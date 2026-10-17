// scry-ignore-file compact-files: readiness, HTTP/SSE accounting and cancellation share one owned native-session lifecycle; the provider-specific module is the integration boundary.
import { cp, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentProcess, Launch } from "@webappwiz/arbor/probe-runtime";
import type {
	NativeDriver,
	NativeRequest,
	NativeSession,
	NativeUpdate,
} from "./native-adapter";
import type { Json } from "./probe";
import { launchIsolated } from "./probe-adapters";
import type { Allowance } from "./probe-affordability";

/** Run focused probes with an owned native OpenCode server and a provider/model selector. */
export function opencodeDriver(options: {
	allowance: Allowance;
	executable?: string;
	/** Free transport seam. Production leaves both unset. */
	launch?: Launch;
	fetch?: typeof globalThis.fetch;
}): NativeDriver {
	const allowance = { ...options.allowance };
	if (
		!Number.isSafeInteger(allowance.tokens) ||
		allowance.tokens <= 0 ||
		!Number.isSafeInteger(allowance.microUsd) ||
		allowance.microUsd <= 0
	) {
		throw new Error("Invalid OpenCode reservation");
	}
	return {
		id: "native-opencode",
		version: "1",
		config: {
			executable: options.executable ?? "opencode",
			allowance,
			protocol: "1.19.3-legacy-http",
			usage: "reported-message-totals-incomplete",
		},
		limits: { tokens: "monitored", costUsd: "monitored" },
		quote: (_probe, model) => (model?.includes("/") ? { ...allowance } : null),
		create: (request) => new OpenCodeSession(request, options),
	};
}

type Options = Parameters<typeof opencodeDriver>[0];
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Malformed OpenCode object");
	}
	return value as ObjectValue;
}
function array(value: unknown): unknown[] {
	if (!Array.isArray(value)) {
		throw new Error("Malformed OpenCode array");
	}
	return value;
}
function sum(values: (number | null)[]): number | null {
	return values.length && values.every((value) => value !== null)
		? values.reduce<number>((total, value) => total + (value ?? 0), 0)
		: null;
}
function number(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: null;
}

function unavailable(message: string): Error {
	return Object.assign(new Error(message), { name: "OpenCodeUnsupported" });
}

class OpenCodeSession implements NativeSession {
	private process?: AgentProcess;
	private base?: string;
	private session?: string;
	private readonly owned = new Set<string>();
	private stopped = false;
	private cancellation?: Promise<void>;
	private disposal?: Promise<void>;
	private output?: Promise<void>;
	private stopOutput?: () => Promise<void>;
	private events?: Promise<void>;
	private readonly stream = new AbortController();
	private readonly io = new AbortController();
	private emit?: (update: NativeUpdate) => void;
	private readonly messages = new Map<
		string,
		{ tokens: number | null; costUsd: number | null }
	>();
	constructor(
		private request: NativeRequest,
		private options: Options,
	) {}
	private unsupported(detail: string) {
		this.request.context.evidence.termination = "unsupported";
		this.request.context.evidence.detail = detail;
	}
	private async api(
		path: string,
		method = "GET",
		body?: unknown,
		signal = this.io.signal,
	): Promise<unknown> {
		if (!this.base) {
			throw new Error("OpenCode server not ready");
		}
		const url = new URL(path, this.base);
		url.searchParams.set(
			"directory",
			this.request.context.isolation.repository,
		);
		const response = await (this.options.fetch ?? globalThis.fetch)(url, {
			method,
			signal,
			headers: { "Content-Type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		if (response.status === 401 || response.status === 403) {
			throw unavailable(
				"OpenCode authentication/authorization unavailable; configure native access separately before authorizing a probe.",
			);
		}
		if (!response.ok) {
			throw new Error(`OpenCode ${method} ${path}: HTTP ${response.status}`);
		}
		return response.json();
	}
	async run(emit: (update: NativeUpdate) => void) {
		try {
			await this.execute(emit);
		} catch (error) {
			if (error instanceof Error && error.name === "OpenCodeUnsupported") {
				this.unsupported(error.message);
			} else {
				throw error;
			}
		}
	}
	private async execute(emit: (update: NativeUpdate) => void) {
		this.emit = emit;
		const { context, model, skill, tools } = this.request;
		if (this.stopped || context.signal.aborted) {
			return;
		}
		const match = /^([^/]+)\/(.+)$/.exec(model ?? "");
		if (!match) {
			return this.unsupported("OpenCode requires an explicit provider/model");
		}
		const providerID = match[1] as string;
		const modelID = match[2] as string;
		const permission: Record<string, Json> = { "*": "deny", skill: "allow" };
		for (const tool of tools) {
			if (["exec", "shell", "bash", "arbor", "git"].includes(tool)) {
				permission.bash = "allow";
			} else if (tool === "read") {
				Object.assign(permission, {
					read: "allow",
					glob: "allow",
					grep: "allow",
				});
			} else if (["write", "edit", "patch"].includes(tool)) {
				permission.edit = "allow";
			} else {
				return this.unsupported(
					`OpenCode cannot apply requested tool: ${tool}`,
				);
			}
		}
		// A shell permission is broad native shell access, not an executable sandbox.
		context.runtime.opencodePermissions = permission;
		context.runtime.opencodeUsageScope =
			"reported assistant messages; failed retries/background billing unverified";
		const source = resolve(skill.source);
		const root = await readFile(join(source, "SKILL.md"), "utf8");
		const name = /^name:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*$/m.exec(root)?.[1];
		if (!name || !/^---\r?\n/.test(root)) {
			return this.unsupported(
				"OpenCode skill requires native name frontmatter",
			);
		}
		const home = context.env.HOME;
		if (!home) {
			return this.unsupported("OpenCode requires an isolated native HOME");
		}
		const skillPath = join(home, ".config", "opencode", "skills", name);
		await mkdir(skillPath, { recursive: true });
		await cp(source, skillPath, { recursive: true, dereference: false });
		if (this.stopped) {
			return;
		}
		const config = {
			model,
			permission,
			share: "disabled",
			autoupdate: false,
			compaction: { auto: false },
			agent: { title: { disable: true }, summary: { disable: true } },
		};
		this.process = (
			this.options.launch ?? launchIsolated({ ...context, cleanup: () => {} })
		)(
			[
				this.options.executable ?? "opencode",
				"serve",
				"--hostname=127.0.0.1",
				"--port=0",
			],
			context.isolation.repository,
			{
				...context.env,
				XDG_CONFIG_HOME: join(home, ".config"),
				XDG_DATA_HOME: join(home, ".local", "share"),
				XDG_CACHE_HOME: join(home, ".cache"),
				XDG_STATE_HOME: join(home, ".local", "state"),
				OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
			},
		);
		let ready!: (url: string) => void;
		let failed!: (error: Error) => void;
		const startup = new Promise<string>((res, rej) => {
			ready = res;
			failed = rej;
		});
		const child = this.process;
		const reader = child.output.getReader();
		this.stopOutput = () => reader.cancel();
		this.output = (async () => {
			const decoder = new TextDecoder();
			let pending = "";
			while (true) {
				const frame = await reader.read();
				if (frame.done) {
					break;
				}
				pending += decoder.decode(frame.value.bytes, { stream: true });
				const lines = pending.split("\n");
				pending = lines.pop() ?? "";
				for (const line of lines) {
					const found =
						/^opencode server listening on (http:\/\/127\.0\.0\.1:\d+)\s*$/.exec(
							line,
						);
					if (found?.[1]) {
						ready(found[1]);
					}
				}
			}
			failed(
				new Error(
					"OpenCode server exited before readiness; inspect retained startup trace",
				),
			);
		})().finally(() => reader.releaseLock());
		void this.output.catch(failed);
		const timer = setTimeout(
			() => failed(new Error("OpenCode startup timed out")),
			5000,
		);
		try {
			this.base = await Promise.race([
				startup,
				this.process.exited.then((code) => {
					throw new Error(`OpenCode server exited (${code})`);
				}),
			]);
		} catch (error) {
			if (this.process.stderr().includes("ENOENT")) {
				return this.unsupported(
					"OpenCode executable not found. Install/configure OpenCode separately before explicitly authorizing a native probe; no fallback was launched.",
				);
			}
			throw error;
		} finally {
			clearTimeout(timer);
		}
		if (this.stopped) {
			return;
		}
		const health = object(await this.api("/global/health"));
		context.runtime.opencodeVersion = String(health.version);
		const providers = object(await this.api("/provider"));
		if (!array(providers.connected).includes(providerID)) {
			return this.unsupported(
				`OpenCode native authentication unavailable for ${providerID} in isolated HOME. Configure native authentication separately before explicitly authorizing a probe; no credentials were requested or copied.`,
			);
		}
		const provider = array(providers.all)
			.map(object)
			.find((item) => item.id === providerID);
		if (!provider || !Object.hasOwn(object(provider.models), modelID)) {
			return this.unsupported(`OpenCode model unavailable: ${model}`);
		}
		const skills = array(await this.api("/skill")).map(object);
		if (
			!skills.some(
				(entry) =>
					entry.name === name &&
					resolve(String(entry.location)) === join(skillPath, "SKILL.md"),
			)
		) {
			return this.unsupported(
				"OpenCode did not discover the selected skill source",
			);
		}
		const rules = Object.entries(permission).map(([key, action]) => ({
			permission: key,
			pattern: "*",
			action,
		}));
		const session = object(
			await this.api("/session", "POST", {
				title: "Arbor focused probe",
				permission: rules,
			}),
		);
		if (typeof session.id !== "string") {
			throw new Error("OpenCode session ID missing");
		}
		this.session = session.id;
		this.owned.add(session.id);
		if (JSON.stringify(session.permission) !== JSON.stringify(rules)) {
			return this.unsupported(
				"OpenCode did not confirm session permission rules",
			);
		}
		if (this.stopped) {
			return;
		}
		const url = new URL("/event", this.base);
		url.searchParams.set("directory", context.isolation.repository);
		const response = await (this.options.fetch ?? globalThis.fetch)(url, {
			signal: this.stream.signal,
		});
		if (!response.ok || !response.body) {
			throw new Error("OpenCode event subscription failed");
		}
		this.events = this.consume(response.body);
		void this.events.catch(() => {});
		const text =
			skill.mode === "explicit"
				? `Use the ${name} skill.\n\n${context.probe.input.text}`
				: context.probe.input.text;
		const result = object(
			await Promise.race([
				this.api(
					`/session/${encodeURIComponent(this.session)}/message`,
					"POST",
					{
						model: { providerID, modelID },
						agent: "build",
						parts: [{ type: "text", text }],
					},
				),
				this.events.then(() => {
					throw new Error("OpenCode event stream ended during prompt");
				}),
			]),
		);
		this.message(result.info);
		const info = object(result.info);
		if (info.error) {
			const error = object(info.error);
			if (error.name === "ProviderAuthError") {
				return this.unsupported("OpenCode provider authentication failed");
			}
			throw new Error(`OpenCode response error: ${String(error.name)}`);
		}
		emit({ kind: "trace", value: result as Json });
		if (info.providerID !== providerID || info.modelID !== modelID) {
			throw new Error(
				"OpenCode response did not confirm the selected provider/model",
			);
		}
		// Reconcile owned descendants and intermediate messages without double counting SSE.
		const reconciled = new Set<string>();
		for (const id of this.owned) {
			if (reconciled.has(id)) {
				continue;
			}
			reconciled.add(id);
			for (const child of array(
				await this.api(`/session/${encodeURIComponent(id)}/children`),
			).map(object)) {
				if (child.parentID === id && typeof child.id === "string") {
					this.owned.add(child.id);
				}
			}
			for (const item of array(
				await this.api(`/session/${encodeURIComponent(id)}/message`),
			)) {
				this.message(object(item).info);
			}
		}
		this.usage();
		if (!this.stopped) {
			emit({
				kind: "reply",
				text: array(result.parts)
					.map(object)
					.filter((item) => item.type === "text" && item.ignored !== true)
					.map((item) => String(item.text))
					.join(""),
			});
		}
	}
	private message(value: unknown) {
		const info = object(value);
		if (
			typeof info.sessionID !== "string" ||
			!this.owned.has(info.sessionID) ||
			info.role !== "assistant" ||
			typeof info.id !== "string"
		) {
			return;
		}
		let tokens: number | null = null;
		if (info.tokens) {
			const count = object(info.tokens);
			const cache = count.cache ? object(count.cache) : {};
			// input excludes cache reads/writes; reasoning is separately reported by the native API.
			tokens = sum(
				[
					count.input,
					count.output,
					count.reasoning,
					cache.read,
					cache.write,
				].map(number),
			);
		}
		const key = `${info.sessionID}/${info.id}`;
		const previous = this.messages.get(key);
		const costUsd = number(info.cost);
		// Replayed/older snapshots must not reduce already reported billable usage.
		this.messages.set(key, {
			tokens: tokens === null ? null : Math.max(tokens, previous?.tokens ?? 0),
			costUsd:
				costUsd === null ? null : Math.max(costUsd, previous?.costUsd ?? 0),
		});
		this.usage();
	}
	private usage() {
		const totals = [...this.messages.values()];
		this.emit?.({
			kind: "usage",
			tokens: sum(totals.map((count) => count.tokens)),
			costUsd: sum(totals.map((count) => count.costUsd)),
			final: false,
		});
	}
	private async consume(body: ReadableStream<Uint8Array>) {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let pending = "";
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				pending += decoder.decode(value, { stream: true });
				if (pending.length > 16 * 1024 * 1024) {
					throw new Error("OpenCode SSE frame too large");
				}
				while (true) {
					const separator = /\r?\n\r?\n/.exec(pending);
					if (!separator) {
						break;
					}
					const end = separator.index;
					const frame = pending.slice(0, end);
					pending = pending.slice(end + separator[0].length);
					const data = frame
						.split("\n")
						.filter((line) => line.startsWith("data:"))
						.map((line) => line.slice(5).trimStart())
						.join("\n");
					if (!data) {
						continue;
					}
					const event = object(JSON.parse(data));
					const props = object(event.properties ?? {});
					const info = props.info ? object(props.info) : undefined;
					const part = props.part ? object(props.part) : undefined;
					if (
						event.type === "session.created" &&
						info &&
						typeof info.parentID === "string" &&
						this.owned.has(info.parentID) &&
						typeof info.id === "string"
					) {
						this.owned.add(info.id);
					}
					const sessionID =
						props.sessionID ?? info?.sessionID ?? part?.sessionID;
					if (typeof sessionID !== "string" || !this.owned.has(sessionID)) {
						continue;
					}
					this.emit?.({ kind: "trace", value: event as Json });
					if (event.type === "message.updated") {
						this.message(props.info);
					}
					if (event.type === "session.error") {
						if (
							props.error &&
							object(props.error).name === "ProviderAuthError"
						) {
							throw unavailable(
								"OpenCode provider authentication failed; configure native authentication separately before authorizing a probe.",
							);
						}
						throw new Error("OpenCode session.error");
					}
					if (
						event.type === "permission.asked" ||
						event.type === "question.asked"
					) {
						throw new Error("OpenCode unexpected permission/question request");
					}
				}
			}
		} finally {
			await reader.cancel().catch(() => {});
			reader.releaseLock();
		}
	}
	cancel(): Promise<void> {
		this.stopped = true;
		this.cancellation ??= (async () => {
			try {
				if (this.base) {
					await Promise.all(
						[...this.owned].map((id) =>
							this.api(
								`/session/${encodeURIComponent(id)}/abort`,
								"POST",
								undefined,
								AbortSignal.timeout(500),
							),
						),
					);
				}
			} finally {
				this.io.abort();
				this.stream.abort();
				this.process?.kill();
			}
		})();
		return this.cancellation;
	}
	dispose(): Promise<void> {
		this.disposal ??= (async () => {
			try {
				await this.cancel();
			} finally {
				this.process?.kill();
				await this.process?.exited;
				await this.stopOutput?.().catch(() => {});
				await Promise.allSettled([
					this.output,
					this.events,
					this.process?.exited,
				]);
				this.usage();
			}
		})();
		return this.disposal;
	}
}
