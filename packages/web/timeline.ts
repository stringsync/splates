import type { Decision, Tool } from "@stringsync/splates-server/conversations";
import type { Event } from "@stringsync/splates-server/records";
import { EDITS, label, type Work } from "./work";

/** One row of a turn's timeline. */
export type Item =
	/** The same command run again and again in a row: the last run shows. */
	| { type: "command"; runs: Tool[] }
	| { type: "edit"; tool: Tool }
	| { type: "subagent"; tool: Tool; calls: Tool[] }
	| { type: "tool"; tool: Tool }
	| { type: "event"; event: Event; also: Event[] }
	/** How the person answered the agent asking permission for the call `label`. */
	| { type: "decision"; label: string; decision: Decision }
	/** Words the agent said between its calls, on the way to its reply. */
	| { type: "said"; text: string; at: string | null };

/** The turn as rows, a subagent's calls under it rather than among them. */
export function timeline(work: Work): Item[] {
	const { parts } = work;
	const subagents = new Set(
		parts.flatMap((part) =>
			part.type === "tool" && part.parent !== null ? [part.parent] : [],
		),
	);
	const items: Item[] = [];
	const events = [...(work.events ?? [])].sort((left, right) =>
		left.at.localeCompare(right.at),
	);
	const entries: (Work["parts"][number] | { type: "event"; event: Event })[] =
		[];
	for (const part of parts) {
		const at = "at" in part ? part.at : null;
		while (events[0] !== undefined && at != null && events[0].at <= at) {
			entries.push({ type: "event", event: events.shift() as Event });
		}
		entries.push(part);
	}
	entries.push(...events.map((event) => ({ type: "event" as const, event })));
	entries.forEach((part) => {
		const last = items.at(-1);
		if (part.type === "event") {
			const event = part.event;
			if (
				last?.type === "event" &&
				last.event.action === event.action &&
				last.event.reason === null &&
				event.reason === null &&
				event.action === "task update"
			) {
				last.also.push(event);
			} else {
				items.push({ type: "event", event, also: [] });
			}
			return;
		}
		// Only the person sends files, and this is the agent's turn.
		if (part.type === "image" || part.type === "file") {
			return;
		}
		if (part.type === "text") {
			items.push({
				type: "said",
				text: part.text.trim(),
				at: part.at ?? null,
			});
			return;
		}
		// Shown as a line of its own, between the work before and after.
		if (part.type === "compaction") {
			return;
		}
		// The agent's thoughts to itself never show.
		if (part.type === "thought") {
			return;
		}
		// Above the call it let run, even one a subagent made.
		if (part.decision !== null) {
			items.push({
				type: "decision",
				label: label(part),
				decision: part.decision,
			});
		}
		if (part.parent !== null) {
			return;
		}
		if (subagents.has(part.id) || part.kind === "think") {
			items.push({
				type: "subagent",
				tool: part,
				calls: parts.filter(
					(each): each is Tool =>
						each.type === "tool" && each.parent === part.id,
				),
			});
		} else if (part.kind === "execute") {
			const again =
				last?.type === "command" && label(last.runs[0] as Tool) === label(part);
			if (again) {
				last.runs.push(part);
			} else {
				items.push({ type: "command", runs: [part] });
			}
		} else if (EDITS.has(part.kind ?? "") || part.edits.length > 0) {
			items.push({ type: "edit", tool: part });
		} else {
			items.push({ type: "tool", tool: part });
		}
	});
	return items;
}

/** What the person decided, in a few words, as the permission card says it. */
export function decided(decision: Decision): string {
	const { option } = decision;
	if (option === null) {
		return "Dismissed";
	}
	switch (option.kind) {
		case "allow_once":
			return "Allowed for this session";
		case "allow_always":
			return "Allowed always";
		case "reject_once":
			return "Denied";
		case "reject_always":
			return "Denied always";
		default:
			return option.name;
	}
}
