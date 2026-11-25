import type { AgentRun } from "./agents";
import type { Step } from "./scenario";

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
			} else if (
				item.type === "error" &&
				isCodexMetadataWarning(item.message ?? item.text ?? item)
			) {
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
			const payload = line.error ?? line.message ?? line;
			if (line.type === "error" && isCodexMetadataWarning(payload)) {
				continue;
			}
			run.error = `codex: ${JSON.stringify(payload)}`;
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
			const time = state.time as { start?: unknown; end?: unknown } | undefined;
			const milliseconds = elapsedMilliseconds(time?.start, time?.end);
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
				...(milliseconds === undefined ? {} : { milliseconds }),
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

/**
 * Antigravity's `--print --output-format stream-json`: incremental `step_update`
 * events for assistant text deltas and tool calls, then a final `result` with
 * reply, turns, usage and any error.
 */
export function readAntigravity(lines: Record<string, unknown>[]): AgentRun {
	const transcript: Step[] = [];
	const textSteps = new Map<number, Extract<Step, { kind: "text" }>>();
	const toolSteps = new Map<number, Extract<Step, { kind: "tool" }>>();
	const run: AgentRun = {
		reply: "",
		transcript,
		usd: null,
		tokens: null,
		turns: null,
		error: null,
	};
	for (const line of lines) {
		if (line.event === "step_update") {
			const update = (line.step_update ?? {}) as Record<string, unknown>;
			const index =
				typeof update.step_index === "number" ? update.step_index : -1;
			if (update.step_type === "agent_response") {
				const delta =
					typeof update.text_delta === "string" ? update.text_delta : "";
				const full = typeof update.text === "string" ? update.text : "";
				if (delta !== "") {
					const existing = textSteps.get(index);
					if (existing !== undefined) {
						existing.text += delta;
					} else {
						const step: Extract<Step, { kind: "text" }> = {
							kind: "text",
							text: delta,
						};
						textSteps.set(index, step);
						transcript.push(step);
					}
				} else if (full !== "" && !textSteps.has(index)) {
					const step: Extract<Step, { kind: "text" }> = {
						kind: "text",
						text: full,
					};
					textSteps.set(index, step);
					transcript.push(step);
				}
			} else if (update.step_type === "tool") {
				const info = (update.tool_info ?? {}) as Record<string, unknown>;
				const name = String(update.tool_name ?? info.name ?? "tool");
				const input = JSON.stringify(info.parameters ?? {});
				const output =
					typeof info.output === "string"
						? info.output
						: typeof info.error === "string"
							? info.error
							: null;
				const milliseconds = secondsToMilliseconds(update.duration_seconds);
				const existing = toolSteps.get(index);
				if (existing !== undefined) {
					existing.name = name;
					if (info.parameters !== undefined) {
						existing.input = input;
					}
					if (output !== null) {
						existing.output = output;
					}
					if (milliseconds !== undefined) {
						existing.milliseconds = milliseconds;
					}
				} else {
					const step: Extract<Step, { kind: "tool" }> = {
						kind: "tool",
						name,
						input,
						output,
						...(milliseconds === undefined ? {} : { milliseconds }),
					};
					toolSteps.set(index, step);
					transcript.push(step);
				}
			}
		} else if (line.event === "result") {
			const result = (line.result ?? {}) as Record<string, unknown>;
			run.reply = typeof result.response === "string" ? result.response : "";
			run.turns = numberOr(result.num_turns);
			const usage = (result.usage ?? {}) as Record<string, unknown>;
			run.tokens = sum([
				usage.input_tokens,
				usage.output_tokens,
				usage.thinking_tokens,
				usage.cache_read_tokens,
			]);
			if (
				(typeof result.error === "string" && result.error !== "") ||
				(result.status !== undefined && result.status !== "SUCCESS")
			) {
				run.error =
					typeof result.error === "string" && result.error !== ""
						? `antigravity: ${result.error}`
						: `antigravity ended: ${String(result.status)}`;
			}
		}
	}
	if (run.reply === "") {
		run.reply = lastText(transcript);
	}
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
		if (step.name === "run_command") {
			const input = JSON.parse(step.input) as { CommandLine?: unknown };
			return typeof input.CommandLine === "string" ? [input.CommandLine] : [];
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

function elapsedMilliseconds(start: unknown, end: unknown): number | undefined {
	if (
		typeof start === "number" &&
		typeof end === "number" &&
		Number.isFinite(start) &&
		Number.isFinite(end) &&
		start >= 0 &&
		end >= start
	) {
		return end - start;
	}
	return undefined;
}

function secondsToMilliseconds(seconds: unknown): number | undefined {
	if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) {
		return Math.round(seconds * 1000);
	}
	return undefined;
}

function sum(values: unknown[]): number | null {
	const numbers = values.filter((each) => typeof each === "number");
	return numbers.length === 0
		? null
		: numbers.reduce((total, each) => total + each, 0);
}

function isCodexMetadataWarning(value: unknown): boolean {
	const text =
		typeof value === "string"
			? value
			: typeof value === "object" &&
					value !== null &&
					typeof (value as { message?: unknown }).message === "string"
				? (value as { message: string }).message
				: "";
	return /model metadata for .+ not found/i.test(text);
}
