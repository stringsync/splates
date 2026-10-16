import type * as acp from "@agentclientprotocol/sdk";
import type { ConversationState, Edit, Tool } from "./conversation-state";

/** How much of a tool call's output, and of each side of an edit, is kept. */
export const TOOL_CHARS = 20_000;

/**
 * Takes what an update says of a tool call into it. Adapters say it in
 * different places: Claude sends a command's output whole as `rawOutput`
 * once it ends, Codex streams it in `_meta` and says how it exited there.
 */
export function fill(
	tool: Tool,
	update: acp.ToolCall | acp.ToolCallUpdate,
	at: string | null,
): void {
	tool.title = update.title ?? tool.title;
	tool.kind = update.kind ?? tool.kind;
	const input = update.rawInput as
		| {
				command?: unknown;
				pattern?: unknown;
				query?: unknown;
				url?: unknown;
				description?: unknown;
				prompt?: unknown;
				subagent_type?: unknown;
				model?: unknown;
		  }
		| null
		| undefined;
	if (typeof input?.command === "string") {
		tool.command = input.command;
	} else if (Array.isArray(input?.command)) {
		tool.command = input.command.join(" ");
	}
	const target = input?.pattern ?? input?.query ?? input?.url;
	if (typeof target === "string") {
		tool.target = target;
	}
	// Claude's Agent tool: its type is optional, its prompt and description not.
	if (
		typeof input?.subagent_type === "string" ||
		(typeof input?.prompt === "string" && typeof input.description === "string")
	) {
		tool.subagent = {
			type:
				typeof input.subagent_type === "string" ? input.subagent_type : null,
			model: typeof input.model === "string" ? input.model : null,
		};
	}
	if (update.locations != null && update.locations.length > 0) {
		tool.paths = [...new Set(update.locations.map((each) => each.path))];
	}
	const edits = (update.content ?? []).flatMap((each): Edit[] =>
		each.type === "diff"
			? [
					{
						path: each.path,
						old:
							each.oldText == null ? null : each.oldText.slice(0, TOOL_CHARS),
						new: each.newText.slice(0, TOOL_CHARS),
					},
				]
			: [],
	);
	if (edits.length > 0) {
		tool.edits = edits;
		tool.paths = [
			...new Set([...tool.paths, ...edits.map((each) => each.path)]),
		];
	}
	const meta = update._meta as
		| {
				terminal_output_delta?: { data?: unknown };
				terminal_exit?: { exit_code?: unknown };
		  }
		| null
		| undefined;
	const delta = meta?.terminal_output_delta?.data;
	if (typeof delta === "string") {
		tool.output = (tool.output + delta).slice(-TOOL_CHARS);
	}
	const ended = update.status === "completed" || update.status === "failed";
	if (typeof update.rawOutput === "string") {
		tool.output = update.rawOutput.slice(-TOOL_CHARS);
	} else if (ended && tool.output === "") {
		// Until it ends, Claude's content is what the command is for, not what
		// it printed.
		tool.output = (update.content ?? [])
			.flatMap((each) =>
				each.type === "content" && each.content.type === "text"
					? [unfenced(each.content.text)]
					: [],
			)
			.join("\n")
			.slice(-TOOL_CHARS);
	}
	const code = meta?.terminal_exit?.exit_code;
	tool.status =
		typeof code === "number" && code !== 0
			? "failed"
			: (update.status ?? tool.status);
	if (ended) {
		tool.until = at;
	}
}

/** `text` without the code fence an adapter wrapped a command's output in. */
function unfenced(text: string): string {
	const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(text.trim());
	return fenced?.[1] ?? text;
}

/** The tool call `id`, wherever in the conversation it was made. */
export function toolIn(state: ConversationState, id: string): Tool | null {
	for (const message of state.messages) {
		for (const part of message.parts) {
			if (part.type === "tool" && part.id === id) {
				return part;
			}
		}
	}
	return null;
}

/** The subagent's tool call an update came from; null for the agent's own. */
export function parentOf(update: {
	_meta?: { [key: string]: unknown } | null;
}): string | null {
	// Claude stamps it in `_meta`.
	const claude = update._meta?.claudeCode as
		| { parentToolUseId?: unknown }
		| undefined;
	return typeof claude?.parentToolUseId === "string"
		? claude.parentToolUseId
		: null;
}
