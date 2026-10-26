import type { Limits, Step } from "./scenario";

/** An agent a run uses, as the Evals page saves it: `claude`, `codex`, and its model and thinking level. */
export interface AgentPick {
	agent: string;
	model?: string;
	effort?: string;
}

/** How an agent's output stream is written. */
export type Format = "claude" | "codex" | "opencode";

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
export const AGENTS = ["claude", "codex", "opencode"];

const TURNS = 30;
const MINUTES = 10;
const USD = 1;

/**
 * The headless command that runs `pick` on `message` in the current
 * directory, with nothing asked of a person: Claude without the person's
 * user settings or MCP servers, both capped by turns, and Claude by spend.
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
	throw new Error(`no eval runner for agent ${pick.agent}`);
}

/** Runs `argv` in `cwd` until it exits or `minutes` pass, reading its stream as `format`. */
export async function runAgent(
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
				: readOpenCode(lines);
	if (child.signalCode !== null) {
		return {
			...run,
			error: `stopped after ${opts.minutes ?? MINUTES} minutes`,
		};
	}
	if (code !== 0 && run.error === null) {
		return {
			...run,
			error: `${argv[0]} exited ${code}: ${tail(stderr) || tail(stdout)}`,
		};
	}
	return run;
}

/** Where and how long `runAgent` runs an agent. */
export interface AgentOptions {
	cwd: string;
	env: Record<string, string>;
	/** How long it may run, 10 minutes by default. */
	minutes?: number;
}

/** Claude's `stream-json`: assistant text and tool calls, tool results, then one result. */
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
