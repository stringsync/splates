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
	/** Still going: the row counts up; once over, it adds up what the turn did. */
	running: boolean;
}

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
	| { type: "text"; text: string }
	/** The same command run again and again in a row: the last run shows. */
	| { type: "command"; runs: Tool[] }
	| { type: "edit"; tool: Tool }
	| { type: "subagent"; tool: Tool; calls: Tool[] }
	| { type: "tool"; tool: Tool }
	/** How the person answered the agent asking permission for the call `label`. */
	| { type: "decision"; label: string; decision: Decision };

const EDITS = new Set(["edit", "delete", "move"]);
/** The kinds whose titles only restate the kind. */
const UNTITLED = new Set(["read", "execute", ...EDITS]);

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

/** What a tool call is, in a line: the command for one that runs one. */
export function label(tool: Tool): string {
	return tool.command ?? tool.title;
}

/**
 * The files a call works on, for one that names its files rather than a
 * command or a pattern, with the lines a read covers ("1-80") when the agent
 * says.
 */
export function files(tool: Tool): { path: string; lines: string | null }[] {
	if (
		tool.command !== null ||
		tool.target !== null ||
		tool.kind === "execute"
	) {
		return [];
	}
	// Claude says which lines it read at the end of the title: "(1 - 80)".
	const range = /\((\d+) - (\d+)\)$/.exec(tool.title);
	const lines =
		tool.kind === "read" && range !== null ? `${range[1]}-${range[2]}` : null;
	return tool.paths.map((path) => ({ path, lines }));
}

/** How a call went, or goes: one still running once its turn is over has stopped. */
export type State = "running" | "done" | "failed" | "stopped";

export function stateOf(tool: Tool, going: boolean): State {
	switch (tool.status) {
		case "completed":
			return "done";
		case "failed":
			return "failed";
		// Claude leaves a command pending, never in progress, while it runs.
		default:
			return going ? "running" : "stopped";
	}
}

/** Each kind's verb as it goes, once it has gone, and after "Failed to". */
const VERBS: Record<string, [string, string, string]> = {
	read: ["Reading", "Read", "read"],
	edit: ["Editing", "Edited", "edit"],
	delete: ["Deleting", "Deleted", "delete"],
	move: ["Moving", "Moved", "move"],
	search: ["Searching", "Searched", "search"],
	execute: ["Running", "Ran", "run"],
	fetch: ["Fetching", "Fetched", "fetch"],
	subagent: ["Running subagent", "Ran subagent", "run subagent"],
	other: ["Using", "Used", "use"],
};

/**
 * What a call does, or did, in a word or two: "Reading", "Read",
 * "Failed to read", "Stopped reading". A subagent's call says so, whatever
 * its kind.
 */
export function verb(tool: Tool, state: State, subagent = false): string {
	const [doing, did, base] =
		VERBS[subagent ? "subagent" : (tool.kind ?? "other")] ??
		(VERBS.other as [string, string, string]);
	switch (state) {
		case "running":
			return doing;
		case "done":
			return did;
		case "failed":
			return `Failed to ${base}`;
		case "stopped":
			return `Stopped ${doing.toLowerCase()}`;
		default:
			return state satisfies never;
	}
}

/**
 * What a call works on, after its verb: the command it runs, the files it
 * reads or edits by name (a read's lines as `#L1-80`, when the agent says),
 * what it searches for or fetches, or else its title, an MCP tool's as
 * `name (server)`. Nothing, for a read, edit or command yet to say what it
 * works on: Claude titles one "Read File", "Edit" or "Terminal" until then.
 */
export function resource(tool: Tool): string {
	if (tool.command !== null) {
		return tool.command;
	}
	if (tool.target !== null) {
		return tool.target;
	}
	const named = files(tool);
	if (named.length > 0) {
		return named
			.map(({ path, lines }) =>
				lines === null ? split(path).name : `${split(path).name}#L${lines}`,
			)
			.join(", ");
	}
	if (UNTITLED.has(tool.kind ?? "")) {
		return "";
	}
	const mcp = /^mcp__(.+?)__(.+)$/.exec(tool.title);
	return mcp === null ? tool.title : `${mcp[2]} (${mcp[1]})`;
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
		item.type === "command" ? item.runs : "tool" in item ? [item.tool] : [],
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
