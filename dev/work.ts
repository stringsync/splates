import type { Part, Step, Tool } from "../conversations";

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
	/** Still going: the row counts up and says what it is on. */
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
	| { type: "tool"; tool: Tool };

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

/** What a tool call is, in a line: the command for one that runs one. */
export function label(tool: Tool): string {
	return tool.command ?? tool.title;
}

/** What the turn added up to, for the row's one line. */
export interface Summary {
	commands: number;
	failed: number;
	/** Each file changed, with how many tool calls changed it. */
	edited: { path: string; count: number }[];
	read: number;
	searched: number;
	subagents: number;
}

export function summarize(work: Work): Summary {
	const items = timeline(work);
	const tools = items.flatMap((item) =>
		item.type === "reads"
			? item.tools
			: item.type === "command"
				? item.runs
				: "tool" in item
					? [item.tool]
					: [],
	);
	const edited = new Map<string, number>();
	for (const tool of tools) {
		if (EDITS.has(tool.kind ?? "") || tool.edits.length > 0) {
			for (const path of tool.paths) {
				edited.set(path, (edited.get(path) ?? 0) + 1);
			}
		}
	}
	const commands = tools.filter((tool) => tool.kind === "execute");
	const reads = tools.filter((tool) => tool.kind === "read");
	return {
		commands: commands.length,
		failed: commands.filter((tool) => tool.status === "failed").length,
		edited: [...edited].map(([path, count]) => ({ path, count })),
		read: new Set(reads.flatMap((tool) => tool.paths)).size || reads.length,
		searched: tools.filter((tool) => tool.kind === "search").length,
		subagents: items.filter((item) => item.type === "subagent").length,
	};
}

/** The finished row's line: "Worked 3m 12s · 6 commands (1 failed) · …". */
export function worked(work: Work): string {
	const { commands, failed, edited, read, searched, subagents } =
		summarize(work);
	const took =
		work.at === null || work.until === null
			? "Worked"
			: `Worked ${span(work.at, work.until)}`;
	return [
		took,
		commands > 0 &&
			`${count(commands, "command")}${failed > 0 ? ` (${failed} failed)` : ""}`,
		edited.length > 0 && `edited ${count(edited.length, "file")}`,
		read > 0 && `read ${count(read, "file")}`,
		searched > 0 && `searched ${count(searched, "time")}`,
		subagents > 0 && count(subagents, "subagent"),
	]
		.filter(Boolean)
		.join(" · ");
}

/** What the agent is on right now, as of `now`; null between steps. */
export function doing(work: Work, now: number): string | null {
	const last = work.parts.at(-1);
	if (last === undefined || last.type === "text" || last.type === "image") {
		return null;
	}
	if (last.type === "thought") {
		return last.at === null ? "Thinking" : `Thinking ${span(last.at, now)}`;
	}
	const top =
		last.parent === null
			? last
			: work.parts.find(
					(each): each is Tool =>
						each.type === "tool" && each.id === last.parent,
				);
	if (
		top === undefined ||
		(top.status !== "pending" && top.status !== "in_progress")
	) {
		return null;
	}
	const item = timeline(work).at(-1);
	const runs = item?.type === "command" ? item.runs.length : 1;
	return [
		label(top),
		runs > 1 && `×${runs}`,
		top.at !== null && span(top.at, now),
	]
		.filter(Boolean)
		.join(" · ");
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
