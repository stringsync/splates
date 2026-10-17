import { spawn } from "node:child_process";
import { cp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	NativeDriver,
	NativeRequest,
	NativeUpdate,
} from "./native-adapter";
import type { Json } from "./probe";
import type { Allowance } from "./probe-affordability";

/** Native Claude Code loop; no synthesized execution/read events or credential copying. */
export function claudeDriver(opts: ClaudeOptions): NativeDriver {
	const executable = opts.executable ?? "claude";
	const allowance = { ...opts.allowance };
	if (
		!Number.isSafeInteger(allowance.tokens) ||
		allowance.tokens <= 0 ||
		!Number.isSafeInteger(allowance.microUsd) ||
		allowance.microUsd <= 0
	) {
		throw new Error("Claude requires a positive integer reservation");
	}
	return {
		id: "native-claude",
		version: "1",
		config: {
			executable,
			allowance,
			usageScope: "query-pipeline estimate; auxiliary calls uncovered",
		},
		limits: { tokens: "monitored", costUsd: "monitored" },
		quote: () => ({ ...allowance }),
		create(request) {
			return session(request, executable, opts.launch ?? launchClaude);
		},
	};
}

/** Injectable process boundary. Completion must include drained output and owned descendants. */
export interface ClaudeProcess {
	completed: Promise<number>;
	cancel(): void;
}
export type ClaudeLaunch = (options: {
	argv: string[];
	cwd: string;
	env: Record<string, string>;
	input: string;
	stdout(text: string): void;
}) => ClaudeProcess;

export interface ClaudeOptions {
	/** Native executable, not an ACP wrapper or a shell command. */
	executable?: string;
	/** Admission reservation, not a guaranteed billing ceiling. */
	allowance: Allowance;
	/** Supply a deterministic transport for free tests; omit for native execution. */
	launch?: ClaudeLaunch;
}

const launchClaude: ClaudeLaunch = ({ argv, cwd, env, input, stdout }) => {
	const child = spawn(argv[0] as string, argv.slice(1), {
		cwd,
		env,
		detached: true,
		stdio: "pipe",
	});
	let stopped = false;
	const cancel = () => {
		if (stopped) {
			return;
		}
		stopped = true;
		if (child.pid !== undefined) {
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch {
				/* The process can exit between checking its pid and signalling it. */
			}
		}
	};
	child.stdout.setEncoding("utf8");
	child.stdout.on("data", stdout);
	// Drain stderr without persisting possible native auth diagnostics/secrets.
	child.stderr.resume();
	child.stdin.on("error", () => {});
	child.stdin.end(input);
	const completed = new Promise<number>((resolve) => {
		child.once("error", () => {}); // close follows failed spawn as well
		child.once("exit", cancel); // descendants may still hold the output pipes
		child.once("close", (code) => {
			cancel();
			resolve(code ?? 127);
		});
	});
	return { completed, cancel };
};

const record = (value: unknown): Record<string, unknown> | undefined =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
const number = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: null;
function sumUsage(value: unknown, fields: string[]): number | null {
	const usage = record(value);
	if (!usage) {
		return null;
	}
	let total = 0;
	for (const field of fields) {
		const count = number(usage[field]);
		if (count === null) {
			return null;
		}
		total += count;
	}
	return Number.isSafeInteger(total) ? total : null;
}

function session(
	request: NativeRequest,
	executable: string,
	launch: ClaudeLaunch,
) {
	const { context, model, tools, skill, allowance } = request;
	const owned: ClaudeProcess[] = [];
	let cancelled = false;
	let work: Promise<void> | undefined;
	const cancel = () => {
		cancelled = true;
		for (const child of owned) {
			child.cancel();
		}
	};
	const unsupported = (detail: string) => {
		context.evidence.termination = "unsupported";
		context.evidence.detail = detail;
	};
	const check = () => {
		context.signal.throwIfAborted();
		if (cancelled) {
			throw new Error("Claude cancelled");
		}
	};
	async function command(
		args: string[],
		input: string,
		stdout: (text: string) => void,
	) {
		check();
		const child = launch({
			argv: [executable, ...args],
			cwd: context.isolation.repository,
			env: context.env,
			input,
			stdout,
		});
		owned.push(child);
		return child.completed;
	}
	async function run(emit: (update: NativeUpdate) => void) {
		if (!model || !/^[\w.:-]+$/.test(model)) {
			return unsupported(
				"Claude requires an explicit native model id or alias",
			);
		}
		if (context.probe.stop.kind !== "reply") {
			return unsupported(
				"Claude does not certify execution events required for event stops",
			);
		}
		if (
			tools.some((tool) => tool === "arbor" || tool === "git") &&
			!tools.some((tool) => tool === "shell" || tool === "exec")
		) {
			return unsupported(
				"Claude cannot exclusively constrain Bash to named arbor/git commands while retaining native project permissions; an explicit shell/exec capability is required",
			);
		}
		const native = new Set<string>();
		const allowed = new Set<string>();
		for (const tool of tools) {
			const mapped: Record<string, string[]> = {
				read: ["Read", "Glob", "Grep"],
				write: ["Write", "Edit"],
				shell: ["Bash"],
				exec: ["Bash"],
				arbor: ["Bash"],
				git: ["Bash"],
			};
			const names = mapped[tool];
			if (!names) {
				return unsupported(`Claude cannot enforce requested tool: ${tool}`);
			}
			for (const name of names) {
				allowed.add(name);
				native.add(name.split("(")[0] as string);
			}
		}
		// Skill is native instruction activation, not a replacement tool loop.
		if (tools.length) {
			native.add("Skill");
			allowed.add("Skill");
		}
		context.runtime.claudeBudget =
			"monitored tokens and estimated USD; in-flight overshoot possible";
		context.runtime.claudeUsage =
			"Cumulative query-pipeline estimates exclude auxiliary calls; completeness remains false";
		let help = "";
		if (
			(await command(["--help"], "", (text) => {
				help += text;
			})) !== 0
		) {
			return unsupported("Claude executable unavailable");
		}
		for (const flag of [
			"--model",
			"--tools",
			"--allowedTools",
			"--permission-mode",
			"--permission-prompts",
			"--max-budget-usd",
			"--output-format",
			"--setting-sources",
			"--strict-mcp-config",
			"--no-session-persistence",
		]) {
			if (!help.includes(flag)) {
				return unsupported(`Claude missing native capability ${flag}`);
			}
		}
		let auth = "";
		const authCode = await command(["auth", "status"], "", (text) => {
			auth += text;
		});
		let authenticated = false;
		try {
			authenticated = record(JSON.parse(auth))?.loggedIn === true;
		} catch {
			/* unsupported auth shape */
		}
		if (authCode !== 0 || !authenticated) {
			return unsupported(
				"Claude native authentication unavailable in isolated environment; no credentials copied",
			);
		}
		check();
		// Snapshot only the selected skill into native project discovery; no root instruction injection.
		const destination = join(
			context.isolation.repository,
			".claude",
			"skills",
			"arbor",
		);
		await readFile(join(skill.source, "SKILL.md"), "utf8");
		await mkdir(join(context.isolation.repository, ".claude", "skills"), {
			recursive: true,
		});
		await cp(skill.source, destination, {
			recursive: true,
			errorOnExist: true,
			force: false,
		});
		check();
		const args = [
			"--print",
			"--verbose",
			"--output-format",
			"stream-json",
			"--model",
			model,
			"--tools",
			[...native].join(","),
			"--permission-mode",
			"dontAsk",
			"--permission-prompts",
			"none",
			"--setting-sources",
			"project,local",
			"--strict-mcp-config",
			"--mcp-config",
			'{"mcpServers":{}}',
			"--no-session-persistence",
			"--max-turns",
			String(context.probe.bounds.turns),
			"--max-budget-usd",
			String(allowance.microUsd / 1_000_000),
		];
		if (allowed.size) {
			args.push("--allowedTools", [...allowed].join(","));
		}
		const messages = new Map<string, number>();
		let buffer = "",
			failure: Error | undefined,
			result: Record<string, unknown> | undefined;
		let tokens: number | null = null,
			costUsd: number | null = null;
		const usage = () => emit({ kind: "usage", tokens, costUsd, final: false });
		const line = (text: string) => {
			if (!text.trim() || failure) {
				return;
			}
			try {
				const value: unknown = JSON.parse(text);
				const frame = record(value);
				if (!frame || typeof frame.type !== "string") {
					throw new Error("Invalid Claude frame");
				}
				emit({ kind: "trace", value: value as Json });
				if (frame.type === "system" && frame.subtype === "init") {
					const actual = frame.model;
					const alias = ["opus", "sonnet", "haiku", "fable"].includes(model);
					if (
						typeof actual !== "string" ||
						(actual !== model &&
							!(alias && actual.startsWith(`claude-${model}-`)))
					) {
						throw new Error(`Claude did not select requested model ${model}`);
					}
					if (frame.permissionMode !== "dontAsk") {
						throw new Error("Claude did not apply native permission mode");
					}
					context.runtime.claudeModel = actual;
				}
				if (frame.type === "assistant") {
					const message = record(frame.message);
					const count = sumUsage(message?.usage, [
						"input_tokens",
						"output_tokens",
						"cache_read_input_tokens",
						"cache_creation_input_tokens",
					]);
					if (typeof message?.id === "string" && count !== null) {
						messages.set(
							message.id,
							Math.max(messages.get(message.id) ?? 0, count),
						);
						tokens = Math.max(
							tokens ?? 0,
							[...messages.values()].reduce((total, count) => total + count, 0),
						);
						usage();
					}
				}
				if (frame.type === "result") {
					result = frame;
					const turns = number(frame.num_turns);
					if (turns !== null && Number.isSafeInteger(turns)) {
						context.usage.turns = Math.max(context.usage.turns, turns);
					}
					const models = record(frame.modelUsage);
					const counts =
						models &&
						Object.values(models).map((entry) =>
							sumUsage(entry, [
								"inputTokens",
								"outputTokens",
								"cacheReadInputTokens",
								"cacheCreationInputTokens",
							]),
						);
					if (
						!frame.startup_failure_reason &&
						counts?.length &&
						counts.every((count) => count !== null)
					) {
						tokens = Math.max(
							tokens ?? 0,
							counts.reduce<number>((total, count) => total + (count ?? 0), 0),
						);
					}
					const cost = number(frame.total_cost_usd);
					if (!frame.startup_failure_reason && cost !== null) {
						costUsd = Math.max(costUsd ?? 0, cost);
					}
					usage();
				}
			} catch (error) {
				failure = error instanceof Error ? error : new Error(String(error));
				cancel();
			}
		};
		const code = await command(
			args,
			skill.mode === "explicit"
				? `/arbor ${context.probe.input.text}`
				: context.probe.input.text,
			(text) => {
				buffer += text;
				let end = buffer.indexOf("\n");
				while (end >= 0) {
					line(buffer.slice(0, end));
					buffer = buffer.slice(end + 1);
					end = buffer.indexOf("\n");
				}
				if (buffer.length > 8_000_000) {
					failure = new Error("Claude frame exceeds 8MB");
					cancel();
				}
			},
		);
		line(buffer);
		if (failure) {
			throw failure;
		}
		if (cancelled || context.signal.aborted) {
			return;
		}
		if (
			result?.subtype === "error_max_turns" ||
			result?.subtype === "error_max_budget_usd"
		) {
			context.evidence.termination = "bound";
			context.evidence.detail = `Claude ${result.subtype}; monitored budget may overshoot`;
			return;
		}
		if (
			code !== 0 ||
			result?.is_error === true ||
			result?.subtype !== "success"
		) {
			throw new Error(
				`Claude native run failed (exit ${code}, ${String(result?.subtype ?? "missing result")})`,
			);
		}
		if (typeof context.runtime.claudeModel !== "string") {
			throw new Error("Claude success missing model initialization");
		}
		if (typeof result.result !== "string") {
			throw new Error("Claude success missing reply");
		}
		emit({ kind: "reply", text: result.result });
	}
	return {
		run(emit: (update: NativeUpdate) => void) {
			if (work) {
				throw new Error("Claude session already started");
			}
			work = run(emit);
			return work;
		},
		cancel,
		async dispose() {
			cancel();
			await Promise.all(owned.map((child) => child.completed));
			await work?.catch(() => {});
		},
	};
}
