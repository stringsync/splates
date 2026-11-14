import { join } from "node:path";
import { codexEvidence } from "./codex-evidence";
import type { Limits, Step } from "./scenario";

/** `kimi` as found on the PATH, then `KIMI_PATH`, then the installer's home, ahead of the arguments to run it with. */
const KIMI_CLI = [
	"sh",
	"-c",
	// biome-ignore lint/suspicious/noTemplateCurlyInString: shell syntax, not a template
	'exec "${KIMI_PATH:-$(command -v kimi || echo "$HOME/.kimi-code/bin/kimi")}" "$@"',
	"kimi",
];

/** An agent a run uses, as the Evals page saves it, with its model and thinking level. */
export interface AgentPick {
	agent: string;
	model?: string;
	effort?: string;
}

/** How an agent's output stream is written. */
export type Format = "claude" | "codex" | "opencode" | "kimi";

/** What one agent run came to. */
export interface AgentRun {
	reply: string;
	transcript: Step[];
	usd: number | null;
	tokens: number | null;
	turns: number | null;
	/** Why it did not finish, when it did not. */
	error: string | null;
}

/** The agents a run can use. */
export const AGENTS = ["claude", "codex", "opencode", "kimi"];

const TURNS = 30;
const MINUTES = 10;
const USD = 1;

/**
 * The headless command that runs `pick` on `message` in the current
 * directory, with nothing asked of a person: Claude without the person's
 * user settings or MCP servers, Claude and Kimi capped by turns, and Claude
 * by spend.
 */
export function commandFor(
	pick: AgentPick,
	message: string,
	limits: Limits = {},
): { argv: string[]; format: Format } {
	if (pick.agent === "claude") {
		return {
			format: "claude",
			argv: [
				"claude",
				"--print",
				"--verbose",
				"--output-format",
				"stream-json",
				...(pick.model === undefined ? [] : ["--model", pick.model]),
				...(pick.effort === undefined ? [] : ["--effort", pick.effort]),
				"--permission-mode",
				"bypassPermissions",
				"--setting-sources",
				"project,local",
				"--strict-mcp-config",
				"--mcp-config",
				'{"mcpServers":{}}',
				"--no-session-persistence",
				"--max-turns",
				String(limits.turns ?? TURNS),
				"--max-budget-usd",
				String(limits.usd ?? USD),
				message,
			],
		};
	}
	if (pick.agent === "codex") {
		return {
			format: "codex",
			argv: [
				"codex",
				"exec",
				"--json",
				"--dangerously-bypass-approvals-and-sandbox",
				"--skip-git-repo-check",
				// Its shell tool drops all but core variables by default, which
				// would hide the sandbox's PATH and ZDOTDIR from `zsh -lc`.
				"-c",
				"shell_environment_policy.inherit=all",
				// Its snapshot of the person's login shell would restore their PATH
				// over the sandbox's on every command.
				"-c",
				"features.shell_snapshot=false",
				...(pick.model === undefined ? [] : ["--model", pick.model]),
				...(pick.effort === undefined
					? []
					: ["-c", `model_reasoning_effort="${pick.effort}"`]),
				message,
			],
		};
	}
	if (pick.agent === "opencode") {
		const model =
			pick.model === undefined
				? []
				: [
						"--model",
						pick.effort === undefined
							? pick.model
							: `${pick.model}#${pick.effort}`,
					];
		return {
			format: "opencode",
			argv: [
				"opencode",
				"run",
				"--standalone",
				"--auto",
				"--format",
				"json",
				...model,
				message,
			],
		};
	}
	if (pick.agent === "kimi") {
		// Kimi takes its thinking level and step cap from the env alone, and
		// may live off the PATH, where the roster looks for it too. Its prompt
		// mode never asks, and refuses --auto.
		const env = [
			`KIMI_LOOP_MAX_STEPS_PER_TURN=${limits.turns ?? TURNS}`,
			"KIMI_CODE_NO_AUTO_UPDATE=1",
			...(pick.effort === undefined
				? []
				: [`KIMI_MODEL_THINKING_EFFORT=${pick.effort}`]),
		];
		return {
			format: "kimi",
			argv: [
				"env",
				...env,
				...KIMI_CLI,
				"--output-format",
				"stream-json",
				...(pick.model === undefined ? [] : ["--model", pick.model]),
				"--prompt",
				message,
			],
		};
	}
	throw new Error(`no eval runner for agent ${pick.agent}`);
}

/**
 * Runs `argv` in `cwd` until it exits or `minutes` pass, reading its stream
 * as `format`. With `opts.followUp`, a turn that ends without a final answer
 * is resumed in the same session, up to the cap, and the turns come back as
 * one run.
 */
export async function runAgent(
	argv: string[],
	format: Format,
	opts: AgentOptions,
): Promise<AgentRun> {
	let run = await runTurn(argv, format, opts);
	const followUp = opts.followUp;
	if (followUp === undefined) {
		return run;
	}
	for (let i = 0; i < followUp.turns; i++) {
		if (run.error !== null || followUp.done(run)) {
			break;
		}
		const next = await runTurn(followUp.argv, format, opts);
		run = {
			reply: next.reply,
			transcript: [...run.transcript, ...next.transcript],
			usd: addOrNull(run.usd, next.usd),
			tokens: addOrNull(run.tokens, next.tokens),
			turns: addOrNull(run.turns, next.turns),
			error: next.error,
		};
	}
	return run;
}

async function runTurn(
	argv: string[],
	format: Format,
	opts: AgentOptions,
): Promise<AgentRun> {
	const child = Bun.spawn(argv, {
		cwd: opts.cwd,
		env: opts.env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		timeout: (opts.minutes ?? MINUTES) * 60_000,
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	const lines = stdout.split("\n").flatMap((line) => {
		try {
			return [JSON.parse(line) as Record<string, unknown>];
		} catch {
			return [];
		}
	});
	const run =
		format === "claude"
			? readClaude(lines)
			: format === "codex"
				? readCodex(lines)
				: format === "kimi"
					? readKimi(lines)
					: readOpenCode(lines);
	if (format === "codex" && code === 0) {
		const thread = lines.find(
			(line) => line.type === "thread.started",
		)?.thread_id;
		const home =
			opts.env.CODEX_HOME ??
			(opts.env.HOME ? join(opts.env.HOME, ".codex") : undefined);
		if (typeof thread === "string" && home !== undefined) {
			try {
				const evidence = await codexEvidence(thread, opts.cwd, home);
				run.transcript.push(
					{
						kind: "text",
						text: "HARNESS: Supplemental native tool calls from this exact Codex session follow in their original order. These supplement the summarized event stream above; they are not additional actions after the reply.",
					},
					...evidence,
				);
			} catch (error) {
				run.error ??= error instanceof Error ? error.message : String(error);
			}
		}
	}
	if (child.signalCode !== null) {
		return {
			...run,
			error: `stopped after ${opts.minutes ?? MINUTES} minutes`,
		};
	}
	if (code !== 0 && run.error === null) {
		return {
			...run,
			error: `${format} exited ${code}: ${tail(stderr) || tail(stdout)}`,
		};
	}
	return run;
}

/** Where and how long `runAgent` runs an agent. */
export interface AgentOptions {
	cwd: string;
	env: Record<string, string>;
	/** How long each turn may run, 10 minutes by default. */
	minutes?: number;
	/** Off by default: the agent runs once. */
	followUp?: FollowUp;
}

/** How `runAgent` resumes an agent whose turn ended without a final answer. */
export interface FollowUp {
	/** The most follow-up turns it may add. */
	turns: number;
	/** The command that resumes the same session, from `continueCommand`. */
	argv: string[];
	/** Whether the run so far holds its final answer. */
	done: (run: AgentRun) => boolean;
}

/** Message a follow-up turn sends. */
export const CONTINUE_MESSAGE =
	"Continue with the task and finish it, then give your final answer.";

/** The command that sends `message` to `pick`'s last session here, for `FollowUp.argv`. Throws for any agent but OpenCode. */
export function continueCommand(
	pick: AgentPick,
	message: string = CONTINUE_MESSAGE,
	limits: Limits = {},
): { argv: string[]; format: Format } {
	if (pick.agent !== "opencode") {
		throw new Error(`no follow-up turns for agent ${pick.agent}`);
	}
	const { argv, format } = commandFor(pick, message, limits);
	return { argv: [...argv.slice(0, -1), "--continue", message], format };
}

/** Read a Claude stream-json run as the reply, tool evidence and usage to grade. */
export function readClaude(lines: Record<string, unknown>[]): AgentRun {
	const transcript: Step[] = [];
	const calls = new Map<string, Extract<Step, { kind: "tool" }>>();
	const run: AgentRun = {
		reply: "",
		transcript,
		usd: null,
		tokens: null,
		turns: null,
		error: null,
	};
	for (const line of lines) {
		const content = contentOf(line);
		if (line.type === "assistant") {
			for (const part of content) {
				if (part.type === "text" && typeof part.text === "string") {
					transcript.push({ kind: "text", text: part.text });
				} else if (part.type === "tool_use") {
					const step: Extract<Step, { kind: "tool" }> = {
						kind: "tool",
						name: String(part.name),
						input: JSON.stringify(part.input ?? {}),
						output: null,
					};
					calls.set(String(part.id), step);
					transcript.push(step);
				}
			}
		} else if (line.type === "user") {
			for (const part of content) {
				const step = calls.get(String(part.tool_use_id));
				if (part.type === "tool_result" && step !== undefined) {
					step.output = textOf(part.content);
				}
			}
		} else if (line.type === "result") {
			run.reply = typeof line.result === "string" ? line.result : "";
			run.usd = numberOr(line.total_cost_usd);
			run.turns = numberOr(line.num_turns);
			const usage = (line.usage ?? {}) as Record<string, unknown>;
			run.tokens = sum([
				usage.input_tokens,
				usage.output_tokens,
				usage.cache_read_input_tokens,
				usage.cache_creation_input_tokens,
			]);
			if (line.is_error === true || line.subtype !== "success") {
				run.error = `claude ended: ${String(line.subtype)}`;
			}
		}
	}
	if (run.reply === "") {
		run.reply = lastText(transcript);
	}
	return run;
}

/** Codex's `exec --json`: items as they complete, and each turn's usage. */
export function readCodex(lines: Record<string, unknown>[]): AgentRun {
	const transcript: Step[] = [];
	const run: AgentRun = {
		reply: "",
		transcript,
		usd: null,
		tokens: null,
		turns: 0,
		error: null,
	};
	for (const line of lines) {
		if (line.type === "item.completed") {
			const item = (line.item ?? {}) as Record<string, unknown>;
			if (item.type === "agent_message" && typeof item.text === "string") {
				transcript.push({ kind: "text", text: item.text });
			} else if (item.type === "command_execution") {
				transcript.push({
					kind: "tool",
					name: "shell",
					input: String(item.command ?? ""),
					output: `${String(item.aggregated_output ?? "")}${item.exit_code === undefined ? "" : `\n(exit ${String(item.exit_code)})`}`,
				});
			} else if (item.type !== "reasoning") {
				transcript.push({
					kind: "tool",
					name: String(item.type),
					input: JSON.stringify(item),
					output: null,
				});
			}
		} else if (line.type === "turn.completed") {
			run.turns = (run.turns ?? 0) + 1;
			const usage = (line.usage ?? {}) as Record<string, unknown>;
			run.tokens =
				(run.tokens ?? 0) +
				(sum([usage.input_tokens, usage.output_tokens]) ?? 0);
		} else if (line.type === "turn.failed" || line.type === "error") {
			run.error = `codex: ${JSON.stringify(line.error ?? line.message ?? line)}`;
		}
	}
	run.reply = lastText(transcript);
	return run;
}

/** OpenCode's `run --format json`: text and tool parts, each step's cost and tokens, and errors. */
export function readOpenCode(lines: Record<string, unknown>[]): AgentRun {
	const transcript: Step[] = [];
	const run: AgentRun = {
		reply: "",
		transcript,
		usd: null,
		tokens: null,
		turns: 0,
		error: null,
	};
	for (const line of lines) {
		const part = (line.part ?? {}) as Record<string, unknown>;
		if (line.type === "text" && typeof part.text === "string") {
			transcript.push({ kind: "text", text: part.text });
		} else if (line.type === "tool_use") {
			const state = (part.state ?? {}) as Record<string, unknown>;
			transcript.push({
				kind: "tool",
				name: String(part.tool),
				input: JSON.stringify(state.input ?? {}),
				output:
					typeof state.output === "string"
						? state.output
						: typeof state.error === "string"
							? state.error
							: null,
			});
		} else if (line.type === "step_finish") {
			run.turns = (run.turns ?? 0) + 1;
			if (typeof part.cost === "number") {
				run.usd = (run.usd ?? 0) + part.cost;
			}
			const tokens = (part.tokens ?? {}) as Record<string, unknown>;
			const cache = (tokens.cache ?? {}) as Record<string, unknown>;
			run.tokens =
				(run.tokens ?? 0) +
				(sum([tokens.input, tokens.output, cache.read, cache.write]) ?? 0);
		} else if (line.type === "error") {
			const error = (line.error ?? {}) as {
				name?: unknown;
				data?: { message?: unknown };
			};
			run.error = `opencode: ${String(error.data?.message ?? error.name ?? JSON.stringify(line))}`;
		}
	}
	run.reply = lastText(transcript);
	return run;
}

/**
 * Kimi's `--output-format stream-json`: chat messages, each assistant step's
 * text and tool calls, then each tool's result. It reports no usage.
 */
export function readKimi(lines: Record<string, unknown>[]): AgentRun {
	const transcript: Step[] = [];
	const calls = new Map<string, Extract<Step, { kind: "tool" }>>();
	const run: AgentRun = {
		reply: "",
		transcript,
		usd: null,
		tokens: null,
		turns: 0,
		error: null,
	};
	for (const line of lines) {
		if (line.role === "assistant") {
			run.turns = (run.turns ?? 0) + 1;
			if (typeof line.content === "string" && line.content !== "") {
				transcript.push({ kind: "text", text: line.content });
			}
			const toolCalls = Array.isArray(line.tool_calls) ? line.tool_calls : [];
			for (const call of toolCalls as Record<string, unknown>[]) {
				const fn = (call.function ?? {}) as Record<string, unknown>;
				const step: Extract<Step, { kind: "tool" }> = {
					kind: "tool",
					name: String(fn.name),
					input: String(fn.arguments ?? "{}"),
					output: null,
				};
				calls.set(String(call.id), step);
				transcript.push(step);
			}
		} else if (line.role === "tool") {
			const step = calls.get(String(line.tool_call_id));
			if (step !== undefined) {
				step.output = textOf(line.content);
			}
		} else if (line.type === "error") {
			run.error = `kimi: ${String(line.message ?? JSON.stringify(line))}`;
		}
	}
	run.reply = lastText(transcript);
	return run;
}

/** Each shell command a transcript ran, as the agent wrote it. */
export function commandsOf(transcript: readonly Step[]): string[] {
	return transcript.flatMap((step) => {
		if (step.kind !== "tool") {
			return [];
		}
		if (step.name === "shell") {
			return [step.input];
		}
		if (step.name === "bash") {
			const input = JSON.parse(step.input) as { command?: unknown };
			return typeof input.command === "string" ? [input.command] : [];
		}
		if (step.name === "Bash") {
			const input = JSON.parse(step.input) as { command?: unknown };
			return typeof input.command === "string" ? [input.command] : [];
		}
		return [];
	});
}

function contentOf(line: Record<string, unknown>): Record<string, unknown>[] {
	const message = (line.message ?? {}) as { content?: unknown };
	return Array.isArray(message.content)
		? (message.content as Record<string, unknown>[])
		: [];
}

function textOf(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	return Array.isArray(content)
		? content
				.map((part) =>
					typeof part?.text === "string" ? part.text : JSON.stringify(part),
				)
				.join("\n")
		: "";
}

function lastText(transcript: readonly Step[]): string {
	return transcript.findLast((step) => step.kind === "text")?.text ?? "";
}

function addOrNull(first: number | null, second: number | null): number | null {
	return first === null && second === null
		? null
		: (first ?? 0) + (second ?? 0);
}

function numberOr(value: unknown): number | null {
	return typeof value === "number" ? value : null;
}

function sum(values: unknown[]): number | null {
	const numbers = values.filter((each) => typeof each === "number");
	return numbers.length === 0
		? null
		: numbers.reduce((total, each) => total + each, 0);
}

function tail(text: string): string {
	return text.trim().split("\n").slice(-5).join("\n");
}
