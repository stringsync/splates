import type { Flag } from "@stringsync/splates-server/agents";
import type {
	Compaction,
	Message,
	Part,
	Step,
	Tool,
} from "@stringsync/splates-server/conversations";
import type { Event } from "@stringsync/splates-server/records";
import { Duration } from "webappwiz/time";
import { workingSpan } from "./work-time";

/**
 * A run of what an agent did between the words it says: its tool calls, intermediate words, and
 * its thoughts, which the page never shows, folded into one row.
 */
export interface Work {
	/** Permission waits across this turn, clipped to this row when timed. */
	waits?: { from: string; to: string | null }[];
	/** Its thoughts, tool calls, and words, in the order it went. */
	parts: Part[];
	/** The turn's plan, on its last row; null on the others. */
	plan: Step[] | null;
	/** When it began: for a turn's first, the person's prompt it answers. */
	at: string | null;
	/** When the agent last moved in it. */
	until: string | null;
	/** Still going, with nothing said since: its last thought is still being thought. */
	running: boolean;
	/** Whether the row says Working rather than how long it worked: only the turn's last line while it goes on, so nothing, words, splates's lines or a compaction, ever shows below one. */
	working: boolean;
	/** The turn is still going, so a call yet to finish is running, not stopped. */
	going: boolean;
}

/**
 * A stretch of an agent's turn: words it said, something splates did at its
 * word, or the work around them.
 */
export type Stretch =
	| { type: "said"; text: string }
	/** `also` is the events folded into it: a run of one action that reads as one line. */
	| { type: "event"; event: Event; also?: Event[] }
	/** The agent folded its context into a summary, between the work before and after. */
	| { type: "compaction"; compaction: Compaction }
	/** A tool call that left a command running in the background, on a line of its own. */
	| { type: "background"; tool: Tool }
	| { type: "work"; work: Work };

/** A stretch before its work is summed up: the work still its parts. */
type Piece = Part[] | Exclude<Stretch, { type: "work" }>;

/**
 * The agent's turn as rows of work, each folded, with intermediate words folded inside them, then the last thing it said, and, once the
 * turn is over, a row for any work after that.
 */
export function stretchesOf(
	message: Message,
	/** When the turn began: the person's prompt it answers. */
	began: string | null,
	going: boolean,
	/** The clock, as epoch ms, which words said while it goes are held by. */
	now = Number.POSITIVE_INFINITY,
	/** What splates did at its word during it, oldest first. */
	events: readonly Event[] = [],
	waiting: string | null = null,
	/**
	 * The turn did not end on its own: stopped, cut short, steered into, or
	 * carried on by an agent coming back.
	 */
	unended = false,
): Stretch[] {
	const parts = spoken(message);
	// While the turn goes on, words with work after them were on the way, and
	// so are the latest until a moment has passed with nothing after them:
	// an agent says what it will do next as it does it, and showing those
	// words as its reply would only take them back as the next call starts.
	// A turn that did not end on its own replies only with words nothing came
	// after. Once over, the last words are its reply, even with work after them.
	const spoke = parts.findLastIndex((part) => part.type === "text");
	const due = going ? replyDue(message) : null;
	const last =
		((going || unended) && spoke !== parts.length - 1) ||
		(going && due !== null && now < due)
			? -1
			: spoke;
	const said = parts[last];
	const before = last === -1 ? parts : parts.slice(0, last);
	const after = last === -1 ? [] : parts.slice(last + 1);
	const pieces: Piece[] = [];
	// Its plan shows on a row of its own, above what it said, even with no work,
	// and so does a turn going with nothing to show yet, so the row says Working
	// in the place its work will fill.
	if (
		before.length > 0 ||
		(after.length === 0 && message.plan !== null) ||
		(going && last === -1)
	) {
		pieces.push(...cut(before));
	}
	if (said?.type === "text") {
		pieces.push({ type: "said", text: said.text });
	}
	if (after.length > 0) {
		pieces.push(after);
	}
	const ordered = folded(placed(pieces, events, message.at));
	// Keep live work below an event, or a command left in the background,
	// even before the agent sends another part.
	const tail = ordered.at(-1);
	if (
		going &&
		tail !== undefined &&
		!Array.isArray(tail) &&
		(tail.type === "event" || tail.type === "background")
	) {
		ordered.push([]);
	}
	// A compaction cuts the work short: the row above it is over, and once
	// the compaction is, a row below says Working until the agent moves.
	if (
		going &&
		tail !== undefined &&
		!Array.isArray(tail) &&
		tail.type === "compaction" &&
		tail.compaction.status !== "in_progress"
	) {
		ordered.push([]);
	}
	const lastWork = ordered.findLastIndex((run) => Array.isArray(run));
	// Thoughts never show, so work with nothing else in it goes, but for the
	// last line while it says Working, or the last row while it holds the plan.
	const kept = ordered.filter(
		(run, index) =>
			!Array.isArray(run) ||
			run.some((part) => part.type !== "thought") ||
			(going && index === ordered.length - 1) ||
			(index === lastWork && message.plan !== null),
	);
	const works = kept.filter((run) => Array.isArray(run));
	const end = kept.length - 1;
	const final = works.at(-1);
	return kept.map((run, index): Stretch => {
		if (!Array.isArray(run)) {
			return run;
		}
		const previous = kept[index - 1];
		const following = kept[index + 1];
		const boundary =
			following === undefined || Array.isArray(following)
				? null
				: following.type === "event"
					? following.event.at
					: following.type === "compaction"
						? following.compaction.at
						: following.type === "background"
							? following.tool.at
							: null;
		const next = kept.slice(index + 1).find((each) => Array.isArray(each));
		const ended = run.flatMap((part) =>
			(part.type === "tool" || part.type === "compaction") &&
			part.until !== null
				? [part.until]
				: [],
		);
		return {
			type: "work",
			work: {
				parts: run,
				waits: [
					...message.parts.flatMap((part) =>
						part.type === "tool" && part.decision?.askedAt != null
							? [{ from: part.decision.askedAt, to: part.decision.at }]
							: [],
					),
					...(waiting === null ? [] : [{ from: waiting, to: null }]),
				],
				plan: run === final ? message.plan : null,
				at:
					run === works[0]
						? began
						: (startOf(run) ??
							(previous === undefined || Array.isArray(previous)
								? null
								: previous.type === "event"
									? previous.event.at
									: previous.type === "compaction"
										? previous.compaction.until
										: previous.type === "background"
											? previous.tool.until
											: null)),
				until:
					index === end
						? message.until
						: (boundary ??
							ended.sort().at(-1) ??
							startOf(next ?? []) ??
							message.until),
				running: going && index === end,
				// Anything below it, words, splates's lines or a compaction, ends
				// it: only the turn's last line says Working, or the compaction
				// going on below it does.
				working: going && index === end,
				going,
			},
		};
	});
}

/**
 * `pieces` with each event placed by its time: before everything when it
 * came before the turn began, the work it fell in cut around it, after the work it came at the end of, and the rest after all.
 */
function placed(
	pieces: Piece[],
	events: readonly Event[],
	/** When the agent began its turn: what was done before it is above all it did. */
	began: string | null,
): Piece[] {
	const left = [...events];
	// The events left that came before `by`, or by it too when `by` is an end.
	const due = (by: string | null, end = false): Piece[] => {
		const later = left.findIndex(
			(event) => by === null || (end ? event.at > by : event.at >= by),
		);
		return left
			.splice(0, later === -1 ? left.length : later)
			.map((event): Piece => ({ type: "event", event }));
	};
	const out: Piece[] = began === null ? [] : due(began, true);
	for (const piece of pieces) {
		if (!Array.isArray(piece)) {
			out.push(piece);
			continue;
		}
		let from = 0;
		piece.forEach((part, index) => {
			const before = due(startOf([part]));
			if (before.length === 0) {
				return;
			}
			if (index > from) {
				out.push(piece.slice(from, index));
			}
			out.push(...before);
			from = index;
		});
		out.push(piece.slice(from), ...due(endOf(piece), true));
	}
	return [...out, ...left.map((event): Piece => ({ type: "event", event }))];
}

/**
 * `pieces` with each run of successful `todo update` events, with nothing
 * between, folded into the first, so a groom reads as one line, and each
 * wait's end folded into its beginning, so it is one line that changes.
 */
function folded(pieces: Piece[]): Piece[] {
	const out: Piece[] = [];
	for (const piece of pieces) {
		const last = out.at(-1);
		const event =
			!Array.isArray(piece) && piece.type === "event" ? piece.event : null;
		const began = event === null ? undefined : beganWith(out, event);
		if (event !== null && began !== undefined) {
			began.also = [...(began.also ?? []), event];
		} else if (
			!Array.isArray(piece) &&
			piece.type === "event" &&
			isUpdate(piece.event) &&
			last !== undefined &&
			!Array.isArray(last) &&
			last.type === "event" &&
			isUpdate(last.event)
		) {
			last.also = [...(last.also ?? []), piece.event];
		} else {
			out.push(
				!Array.isArray(piece) && piece.type === "event" ? { ...piece } : piece,
			);
		}
	}
	return out;
}

/** The beginning in `out` of the wait `event` ends, if it is one. */
function beganWith(
	out: Piece[],
	event: Event,
): Extract<Piece, { type: "event" }> | undefined {
	const began = "began" in event ? event.began : null;
	if (began == null) {
		return undefined;
	}
	return out.find(
		(piece): piece is Extract<Piece, { type: "event" }> =>
			!Array.isArray(piece) &&
			piece.type === "event" &&
			piece.event.id === began,
	);
}

function isUpdate(event: Event): boolean {
	return event.action === "task update" && event.reason === null;
}

/** When the last of `parts` to say so ended, or began. */
function endOf(parts: Part[]): string | null {
	for (const part of [...parts].reverse()) {
		if (
			(part.type === "tool" || part.type === "compaction") &&
			(part.until ?? part.at) !== null
		) {
			return part.until ?? part.at;
		}
		if (part.type === "thought" && part.at !== null) {
			return part.at;
		}
	}
	return null;
}

/**
 * Cut out compaction markers; intermediate prose stays inside the work
 * timeline.
 */
function cut(run: Part[]): Piece[] {
	const pieces: Piece[] = [];
	let from = 0;
	run.forEach((part, at) => {
		if (
			part.type === "compaction" ||
			(part.type === "tool" && part.background !== undefined)
		) {
			if (at > from) {
				pieces.push(run.slice(from, at));
			}
			pieces.push(
				part.type === "compaction"
					? { type: "compaction", compaction: part }
					: { type: "background", tool: part },
			);
			from = at + 1;
		}
	});
	// Kept even empty when nothing was cut, for the row that says Working.
	if (from < run.length || pieces.length === 0) {
		pieces.push(run.slice(from));
	}
	return pieces;
}

/** How long the latest words go without anything after them to show as the reply. */
export const SAID = Duration.secs(1);

/** `message`'s parts as its turn shows them: nothing sent, no empty words. */
function spoken(message: Message): Part[] {
	return message.parts.filter(
		(part) =>
			part.type !== "image" &&
			part.type !== "file" &&
			(part.type !== "text" || part.text.trim() !== ""),
	);
}

/**
 * When the words that end `message`, a turn still going, are to show as its
 * reply, as epoch ms; null when nothing ends it that waits, as words a log
 * too old to say when they began.
 */
export function replyDue(message: Message): number | null {
	const last = spoken(message).at(-1);
	return last?.type === "text" && last.at != null
		? Date.parse(last.at) + SAID.ms
		: null;
}

/** When the first of `parts` to say so began. */
function startOf(parts: Part[]): string | null {
	for (const part of parts) {
		if (
			(part.type === "tool" ||
				part.type === "thought" ||
				part.type === "compaction") &&
			part.at !== null
		) {
			return part.at;
		}
	}
	return null;
}

/** The kinds that change files. */
export const EDITS = new Set(["edit", "delete", "move"]);
/** The kinds whose titles only restate the kind. */
const UNTITLED = new Set(["read", "execute", ...EDITS]);

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

/** The finished row's line: "Worked 3m 12s". */
export function worked(work: Work): string {
	return work.at === null || work.until === null
		? "Worked"
		: `Worked ${workingSpan(work, work.until)}`;
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
