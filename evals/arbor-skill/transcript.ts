import type { Beat, Transcript } from "@webappwiz/arbor/skill-checks";

/**
 * One eval run read back from what `claude -p --output-format stream-json`
 * printed, a list of lines per turn, and the prompt each turn was given,
 * which `-p` does not echo: the beats `skill-checks` judges, every tool the
 * agent called, the text a model grades, and what each turn cost.
 */
export function readRun(turns: string[][], prompts: string[]): RunLog {
	const log: RunLog = {
		transcript: { beats: [], handed: false },
		tools: [],
		text: "",
		usage: [],
	};
	const text: string[] = [];
	// A Bash call's beat waits for its result to say what it printed.
	const pending = new Map<string, { command: string }>();
	turns.forEach((lines, index) => {
		const prompt = prompts[index] ?? "";
		log.transcript.beats.push({ kind: "user", text: prompt });
		text.push(`######## turn ${index + 1}`, `USER: ${prompt}`);
		for (const line of lines) {
			const event = parse(line);
			if (event !== undefined) {
				read(event, { log, text, pending });
			}
		}
	});
	log.text = text.join("\n");
	return log;
}

/** An eval run, as read from its turns. */
export interface RunLog {
	transcript: Transcript;
	/** Every tool the agent itself called, in order; its subagents' are left out. */
	tools: ToolUse[];
	/** The run as text for a model to grade: what was said and done, results cut short. */
	text: string;
	/** What each turn cost, from its closing `result` line; a turn cut off has none. */
	usage: Usage[];
}

export interface ToolUse {
	name: string;
	input: Record<string, unknown>;
	/** Which turn it was called in, from 1. */
	turn: number;
}

/** What one `claude -p` call cost, as it reported it. */
export interface Usage {
	costUsd: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
}

/** A tool result longer than this is cut short in the text a model grades. */
const RESULT_CHARS = 600;

interface Reading {
	log: RunLog;
	text: string[];
	pending: Map<string, { command: string }>;
}

interface StreamEvent {
	type?: string;
	parent_tool_use_id?: string | null;
	message?: { content?: unknown };
	result?: string;
	total_cost_usd?: number;
	usage?: Record<string, number>;
}

interface Block {
	type?: string;
	text?: string;
	id?: string;
	name?: string;
	input?: Record<string, unknown>;
	tool_use_id?: string;
	content?: unknown;
	is_error?: boolean;
}

function read(event: StreamEvent, { log, text, pending }: Reading): void {
	const beats = log.transcript.beats;
	const sub = event.parent_tool_use_id ? " [subagent]" : "";
	const content = event.message?.content;
	if (event.type === "result") {
		log.usage.push(usageOf(event));
		text.push(`FINAL: ${(event.result ?? "").slice(0, 4000)}`);
		return;
	}
	if (!Array.isArray(content)) {
		return;
	}
	for (const block of content as Block[]) {
		if (event.type === "assistant" && block.type === "text") {
			if (!sub) {
				beats.push({ kind: "say", text: block.text ?? "" });
			}
			text.push(`AGENT${sub}: ${block.text ?? ""}\n`);
		} else if (event.type === "assistant" && block.type === "tool_use") {
			const name = block.name ?? "";
			const input = block.input ?? {};
			text.push(`TOOL${sub} ${name}: ${describe(name, input).slice(0, 2500)}`);
			if (sub) {
				continue;
			}
			const turn = beats.filter((each) => each.kind === "user").length;
			log.tools.push({ name, input, turn });
			if (name === "Bash" && block.id !== undefined) {
				pending.set(block.id, { command: String(input.command ?? "") });
			} else if (EDITS.has(name)) {
				beats.push({ kind: "edit", paths: [String(input.file_path ?? "")] });
			}
		} else if (event.type === "user" && block.type === "tool_result") {
			const result = resultText(block.content);
			const cut =
				result.includes("Base directory for this skill") ||
				result.length > RESULT_CHARS;
			text.push(
				`RESULT${sub}: ${cut ? `${result.slice(0, RESULT_CHARS)} …` : result}`,
			);
			const call = pending.get(block.tool_use_id ?? "");
			if (call !== undefined && !sub) {
				pending.delete(block.tool_use_id ?? "");
				beats.push(run(call.command, result, block.is_error !== true));
			}
		}
	}
}

/** The tools that write a file, each naming it in `file_path`. */
const EDITS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

function run(command: string, output: string, ok: boolean): Beat {
	return { kind: "run", command, output, ok };
}

function describe(name: string, input: Record<string, unknown>): string {
	if (EDITS.has(name)) {
		return `${input.file_path}\n${input.content ?? input.new_string ?? ""}`;
	}
	const said =
		input.command ?? input.file_path ?? input.skill ?? input.prompt ?? null;
	return said === null ? JSON.stringify(input) : String(said);
}

function resultText(content: unknown): string {
	if (Array.isArray(content)) {
		return content.map((each: { text?: string }) => each.text ?? "").join(" ");
	}
	return String(content ?? "");
}

function usageOf(event: StreamEvent): Usage {
	const usage = event.usage ?? {};
	return {
		costUsd: event.total_cost_usd ?? 0,
		inputTokens: usage.input_tokens ?? 0,
		outputTokens: usage.output_tokens ?? 0,
		cacheReadTokens: usage.cache_read_input_tokens ?? 0,
		cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
	};
}

function parse(line: string): StreamEvent | undefined {
	try {
		return JSON.parse(line) as StreamEvent;
	} catch {
		// A line cut off as the process died says nothing usable.
		return undefined;
	}
}
