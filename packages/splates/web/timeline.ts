import type { Decision, Tool } from "../conversations";
import { EDITS, label, type Work } from "./work";

/** One row of a turn's timeline. */
export type Item =
	| {
			type: "thought";
			text: string;
			at: string | null;
			until: string | null;
			/** The agent is thinking it still: nothing has come after it in a turn under way. */
			thinking: boolean;
	  }
	/** The same command run again and again in a row: the last run shows. */
	| { type: "command"; runs: Tool[] }
	| { type: "edit"; tool: Tool }
	| { type: "subagent"; tool: Tool; calls: Tool[] }
	| { type: "tool"; tool: Tool }
	/** How the person answered the agent asking permission for the call `label`. */
	| { type: "decision"; label: string; decision: Decision }
	/** Words the agent said between its calls, on the way to its reply. */
	| { type: "said"; text: string };

/** The turn as rows, a subagent's calls under it rather than among them. */
export function timeline(work: Work): Item[] {
	const { parts } = work;
	const subagents = new Set(
		parts.flatMap((part) =>
			part.type === "tool" && part.parent !== null ? [part.parent] : [],
		),
	);
	const items: Item[] = [];
	parts.forEach((part, index) => {
		const last = items.at(-1);
		// Only the person sends files, and this is the agent's turn.
		if (part.type === "image" || part.type === "file") {
			return;
		}
		if (part.type === "text") {
			items.push({ type: "said", text: part.text.trim() });
			return;
		}
		// Shown as a line of its own, between the work before and after.
		if (part.type === "compaction") {
			return;
		}
		if (part.type === "thought") {
			const next = parts
				.slice(index + 1)
				.find(
					(each) =>
						(each.type === "thought" || each.type === "tool") &&
						each.at !== null,
				);
			items.push({
				type: "thought",
				text: part.text,
				at: part.at,
				until:
					(next?.type === "thought" || next?.type === "tool"
						? next.at
						: null) ?? work.until,
				thinking: work.running && index === parts.length - 1,
			});
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
