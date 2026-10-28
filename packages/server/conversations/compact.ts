import type * as acp from "@agentclientprotocol/sdk";
import type { Entry } from "./entry";

type Update = Extract<Entry, { kind: "update" }>;

/**
 * `entries` saved short: replayed, the result leaves the conversation as
 * `entries` do, in a fraction of the lines.
 */
export function compacted(entries: Entry[]): Entry[] {
	// A tool call's updates each repeat its whole input so far while an agent
	// streams it, and a message comes in chunks: each run is joined into one,
	// and a pair that might replay otherwise stays two. Parallel tool calls
	// interleave their updates: one call's are joined across the others'.
	const out: Entry[] = [];
	for (const entry of entries) {
		const last = out.at(-1);
		const one =
			last?.kind === "update" && entry.kind === "update"
				? joined(last, entry)
				: null;
		if (one !== null) {
			out[out.length - 1] = one;
			continue;
		}
		const earlier = entry.kind === "update" ? acrossOthers(out, entry) : null;
		if (earlier === null) {
			out.push(entry);
		} else {
			// Moved to the later place, as a join of neighbors leaves it.
			out.splice(earlier.at, 1);
			out.push(earlier.one);
		}
	}
	return out;
}

/**
 * `then` joined with its tool call's last update in `out`, when only other
 * calls' updates come after that one, and where it is.
 */
function acrossOthers(
	out: Entry[],
	then: Update,
): { at: number; one: Update } | null {
	const id = toolCallOf(then.update);
	if (id === null) {
		return null;
	}
	for (let at = out.length - 1; at >= 0; at--) {
		const each = out[at];
		const other = each?.kind === "update" ? toolCallOf(each.update) : null;
		if (each?.kind !== "update" || other === null) {
			return null;
		}
		if (other === id) {
			const one = joined(each, then);
			return one === null ? null : { at, one };
		}
	}
	return null;
}

/** The tool call `update` is about, if any. */
function toolCallOf(update: acp.SessionUpdate): string | null {
	return update.sessionUpdate === "tool_call" ||
		update.sessionUpdate === "tool_call_update"
		? update.toolCallId
		: null;
}

function joined(first: Update, then: Update): Update | null {
	// Folded with no time, an update leaves the times it would have moved.
	if ((first.at === undefined) !== (then.at === undefined)) {
		return null;
	}
	const seq = then.seq ?? first.seq;
	const tool = joinedTool(first.update, then.update);
	if (tool !== null) {
		return {
			kind: "update",
			update: tool,
			...(then.at === undefined ? {} : { at: then.at }),
			...(seq === undefined ? {} : { seq }),
		};
	}
	const text = joinedText(first.update, then.update);
	if (text !== null) {
		// The part starts at the first chunk; the turn runs until the last.
		const until = then.until ?? then.at ?? first.until;
		return {
			kind: "update",
			update: text,
			...(first.at === undefined ? {} : { at: first.at }),
			...(until === undefined ? {} : { until }),
			...(seq === undefined ? {} : { seq }),
		};
	}
	return null;
}

/** Two updates to one tool call as one, when `fill` reads them alike. */
function joinedTool(
	first: acp.SessionUpdate,
	then: acp.SessionUpdate,
): acp.SessionUpdate | null {
	if (
		first.sessionUpdate !== "tool_call_update" ||
		then.sessionUpdate !== "tool_call_update" ||
		first.toolCallId !== then.toolCallId ||
		// Its end stamps the time; edits add their paths; terminal output
		// and retries add up; and an input read is kept until one replaces it.
		first.status === "completed" ||
		first.status === "failed" ||
		(first.content ?? []).some((each) => each.type === "diff") ||
		!sameMeta(first._meta, then._meta) ||
		!readsOf(first.rawInput).every((read) =>
			readsOf(then.rawInput ?? first.rawInput).includes(read),
		)
	) {
		return null;
	}
	return {
		sessionUpdate: "tool_call_update",
		toolCallId: then.toolCallId,
		title: then.title ?? first.title,
		kind: then.kind ?? first.kind,
		status: then.status ?? first.status,
		// Only an end reads the content, and only the last update's.
		content: then.content,
		locations:
			then.locations != null && then.locations.length > 0
				? then.locations
				: first.locations,
		rawInput: then.rawInput ?? first.rawInput,
		rawOutput:
			typeof then.rawOutput === "string" ? then.rawOutput : first.rawOutput,
		_meta: then._meta,
	};
}

/** Two chunks of one message's text, or of one thought, as one. */
function joinedText(
	first: acp.SessionUpdate,
	then: acp.SessionUpdate,
): acp.SessionUpdate | null {
	if (
		(first.sessionUpdate !== "agent_message_chunk" &&
			first.sessionUpdate !== "agent_thought_chunk") ||
		then.sessionUpdate !== first.sessionUpdate ||
		first.content.type !== "text" ||
		then.content.type !== "text" ||
		// The first words of a turn are timed by the chunk that says them.
		first.content.text === "" ||
		(first.messageId ?? null) !== (then.messageId ?? null) ||
		first._meta != null ||
		then._meta != null
	) {
		return null;
	}
	return {
		...first,
		content: { ...first.content, text: first.content.text + then.content.text },
	};
}

/** Whether two updates' `_meta` say the same, with nothing that adds up. */
function sameMeta(
	first: Record<string, unknown> | null | undefined,
	then: Record<string, unknown> | null | undefined,
): boolean {
	if (first == null || then == null) {
		return first == null && then == null;
	}
	return (
		!ADDS_UP.some((key) => key in first) &&
		JSON.stringify(first) === JSON.stringify(then)
	);
}

const ADDS_UP = ["terminal_output_delta", "terminal_exit", "opencode/retry"];

/** What `fill` takes from a tool call's input. */
function readsOf(input: unknown): string[] {
	if (typeof input !== "object" || input === null) {
		return [];
	}
	const each = input as Record<string, unknown>;
	const reads: string[] = [];
	if (typeof each.command === "string" || Array.isArray(each.command)) {
		reads.push("command");
	}
	if (typeof (each.pattern ?? each.query ?? each.url) === "string") {
		reads.push("target");
	}
	if (
		typeof each.subagent_type === "string" ||
		(typeof each.prompt === "string" && typeof each.description === "string")
	) {
		reads.push("subagent");
	}
	return reads;
}
