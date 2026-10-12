import type { Decision, Part, Step, Tool } from "../conversations";
import type { Flag } from "../watch";

/**
 * What an agent did in a turn before its reply: its thoughts, what it said
 * along the way, and its tool calls, which the page folds into one row.
 */
export interface Work {
	/** Every part of the turn, its reply among them. */
	parts: Part[];
	/** Which part is the reply, shown below the row; null before it says any. */
	reply: number | null;
	plan: Step[] | null;
	/** When the person's prompt went, which the turn's time counts from. */
	at: string | null;
	/** When the agent last moved. */
	until: string | null;
	/** Still going: the row counts up. */
	running: boolean;
}

/** One row of a turn's timeline. */
export type Item =
	| { type: "thought"; text: string; at: string | null; until: string | null }
	| { type: "text"; text: string }
	/** The same command run again and again in a row: the last run shows. */
	| { type: "command"; runs: Tool[] }
	| { type: "edit"; tool: Tool }
	/** Reads and searches in a row, as one. */
	| { type: "reads"; tools: Tool[] }
	| { type: "subagent"; tool: Tool; calls: Tool[] }
	| { type: "tool"; tool: Tool }
	/** How the person answered the agent asking permission for the call `label`. */
	| { type: "decision"; label: string; decision: Decision };

const READS = new Set(["read", "search", "fetch"]);
const EDITS = new Set(["edit", "delete", "move"]);

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
		// Only the person sends images, and this is the agent's turn.
		if (part.type === "image") {
			return;
		}
		if (part.type === "text") {
			if (part.text.trim() !== "" && index !== work.reply) {
				items.push({ type: "text", text: part.text });
			}
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
		} else if (READS.has(part.kind ?? "")) {
			if (last?.type === "reads") {
				last.tools.push(part);
			} else {
				items.push({ type: "reads", tools: [part] });
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

/** What a tool call is, in a line: the command for one that runs one. */
export function label(tool: Tool): string {
	return tool.command ?? tool.title;
}

/** The turn's commands that did to git what they should not have, subagents' among them. */
export function flagged(work: Work): Tool[] {
	return work.parts.filter(
		(part): part is Tool => part.type === "tool" && part.flags.length > 0,
	);
}

/** What a flag says a command did, in a few words. */
export function warning(flag: Flag): string {
	switch (flag.type) {
		case "stashed":
			return flag.count === 1
				? "Stashed changes and left them there"
				: `Stashed ${flag.count} changes and left them there`;
		case "dropped":
			return `Dropped commits from ${flag.branch}`;
		case "left":
			return `Left ${flag.branch} for ${flag.now ?? "a detached HEAD"}`;
		case "pushed":
			return `Pushed ${flag.refs.join(", ")}`;
		case "outside":
			return `Changed ${count(flag.paths.length, "file")} in the main tree`;
		default:
			return flag satisfies never;
	}
}

/** Each file the turn changed, with how many tool calls changed it. */
export function edited(work: Work): { path: string; count: number }[] {
	const paths = new Map<string, number>();
	for (const item of timeline(work)) {
		const tools =
			item.type === "reads"
				? item.tools
				: item.type === "command"
					? item.runs
					: "tool" in item
						? [item.tool]
						: [];
		for (const tool of tools) {
			if (EDITS.has(tool.kind ?? "") || tool.edits.length > 0) {
				for (const path of tool.paths) {
					paths.set(path, (paths.get(path) ?? 0) + 1);
				}
			}
		}
	}
	return [...paths].map(([path, count]) => ({ path, count }));
}

/** The row's line: "Working 1m 5s" as of `now` while it runs, then "Worked 3m 12s". */
export function took(work: Work, now: number): string {
	if (work.running) {
		return work.at === null ? "Working" : `Working ${span(work.at, now)}`;
	}
	return work.at === null || work.until === null
		? "Worked"
		: `Worked ${span(work.at, work.until)}`;
}

/** How long from `from` to `to`, to the second: "41s", "2m 14s", "1h 3m". */
export function span(from: string, to: string | number): string {
	const end = typeof to === "number" ? to : Date.parse(to);
	const secs = Math.max(0, Math.floor((end - Date.parse(from)) / 1000));
	if (secs < 60) {
		return `${secs}s`;
	}
	const mins = Math.floor(secs / 60);
	if (mins < 60) {
		return `${mins}m ${secs % 60}s`;
	}
	return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function count(many: number, noun: string): string {
	return `${many} ${noun}${many === 1 ? "" : "s"}`;
}

/** Where a project's files sit: its main tree and its tasks' worktrees. */
export interface Trees {
	root: string;
	worktreeRoot: string;
}

/**
 * `path` from the top of the tree it is in, the main tree or a task's
 * worktree, even one removed since; a path in neither stays whole.
 */
export function relative(path: string, trees: Trees | null): string {
	if (trees === null) {
		return path;
	}
	const worktrees = `${trees.worktreeRoot}/`;
	if (path.startsWith(worktrees)) {
		const rest = path.slice(worktrees.length);
		const slash = rest.indexOf("/");
		return slash === -1 ? path : rest.slice(slash + 1);
	}
	const root = `${trees.root}/`;
	return path.startsWith(root) ? path.slice(root.length) : path;
}

/** A path as its file's name and the directory it is in, "" for none. */
export function split(path: string): { name: string; dir: string } {
	const slash = path.lastIndexOf("/");
	return {
		name: path.slice(slash + 1),
		dir: path.slice(0, Math.max(slash, 0)),
	};
}
