/**
 * The rules of the arbor skill a program can decide, checked over one
 * conversation: what it said and ran, condensed, and what it left behind.
 * `arbor dev` runs them on its conversations, for the Stats page's pass rate
 * per skill version; the hand-run evals run them on theirs. Rules that take
 * judgment, such as whether a call should have been a question, are left to
 * a model grading the evals.
 */

/** Each check's verdicts on one conversation, by its id. */
export function judge(
	transcript: Transcript,
	end: EndState,
): Record<string, Verdict[]> {
	return Object.fromEntries(
		CHECKS.map((check) => [check.id, check.judge(transcript, end)]),
	);
}

/** A conversation as the checks read it: its own words and acts, in order. */
export interface Transcript {
	beats: Beat[];
	/**
	 * Whether another conversation handed it its task, a lane's orchestrator
	 * or an agent relaying for it, so it reports to that conversation, which
	 * proposes the next todo in its place.
	 */
	handed: boolean;
}

/**
 * One thing said or done. A `user` beat starts a turn. What the agent's
 * subagents did is left out: the rules are the agent's own.
 */
export type Beat =
	| { kind: "user"; text: string }
	/** Words the agent said, one stretch of text between its tool calls. */
	| { kind: "say"; text: string }
	/** A shell command, with the end of what it printed and whether it succeeded. */
	| { kind: "run"; command: string; output: string; ok: boolean }
	/** Files a tool call wrote or edited. */
	| { kind: "edit"; paths: string[] };

/** What the conversation left behind, which its transcript does not say. */
export interface EndState {
	/** Each task it merged, with the message of each commit that landed. */
	landed: { task: string; commits: string[] }[];
}

/** How one place a rule applied went. */
export interface Verdict {
	ok: boolean;
	/** What was checked, and what was found when it failed. */
	why: string;
}

/** A rule a program can decide; `judge` returns no verdicts where it does not apply. */
export interface Check {
	id: string;
	/** The rule, as the Stats page names it. */
	rule: string;
	judge(transcript: Transcript, end: EndState): Verdict[];
}

/** Every check, in the order the Stats page lists them. */
export const CHECKS: readonly Check[] = [
	{
		id: "plan-first",
		rule: "Writes ARBOR.md before the first edit",
		judge: ({ beats }) =>
			added(beats).flatMap(({ at, task }, index, all) => {
				const until = all[index + 1]?.at ?? beats.length;
				const span = beats.slice(at + 1, until);
				const edit = span.findIndex(
					(each) =>
						each.kind === "edit" && each.paths.some((path) => !isPlan(path)),
				);
				if (edit === -1) {
					return [];
				}
				const planned = span.slice(0, edit).some(writesPlan);
				return [
					{
						ok: planned,
						why: planned
							? `${task}: ARBOR.md came first`
							: `${task}: edited before writing ARBOR.md`,
					},
				];
			}),
	},
	{
		id: "report-title",
		rule: "Titles a task's report by how it ended",
		judge: ({ beats }) =>
			endings(beats).map(({ verb, review, report }) => {
				const title = titleOf(report);
				const form = review ? TITLES.review : TITLES[verb];
				return {
					ok: form.test(title),
					why: `${review ? "review" : verb}: ${title ? `"${title}"` : "no report"}`,
				};
			}),
	},
	{
		id: "numbered-questions",
		rule: "Asks two or more questions as a numbered list",
		judge: ({ beats }) =>
			turns(beats).flatMap(({ report }) => {
				const asked = questionLines(report);
				if (asked.length < 2) {
					return [];
				}
				const loose = asked.filter((line) => !NUMBERED.test(line));
				return [
					{
						ok: loose.length === 0,
						why:
							loose.length === 0
								? `${asked.length} questions, all numbered`
								: `not numbered: "${loose[0]?.trim()}"`,
					},
				];
			}),
	},
	{
		id: "next-todo",
		rule: "Proposes the next todo after a merge or remove",
		judge: ({ beats, handed }) =>
			handed
				? []
				: endings(beats)
						.filter(
							({ verb, output }) =>
								verb === "remove" ||
								(verb === "merge" && PROPOSED.test(output)),
						)
						.map(({ verb, report }) => {
							const ok = TODO_HEADING.test(report);
							return {
								ok,
								why: `${verb}: ${ok ? "proposed one" : "proposed none"}`,
							};
						}),
	},
	{
		id: "squashed",
		rule: "Lands one commit with no attribution",
		judge: (_, { landed }) =>
			landed.map(({ task, commits }) => {
				const attributed = commits.find((message) =>
					ATTRIBUTION.some((pattern) => pattern.test(message)),
				);
				return {
					ok: commits.length === 1 && attributed === undefined,
					why:
						commits.length !== 1
							? `${task}: landed ${commits.length} commits`
							: attributed === undefined
								? `${task}: one plain commit`
								: `${task}: attributed`,
				};
			}),
	},
];

/** What a task's report is titled, by how it ended. */
const TITLES = {
	merge: /^## ✅ Merged \S+ onto \S+$/,
	remove: /^## 🛑 Removed \S+: .*[^.!?:]$/,
	escalate: /^## ⚠️? Escalated \S+: .*[^.!?:]$/,
	review: /^## 🔍 Ready to merge \S+ onto \S+$/,
};

/** A proposed todo's heading. */
const TODO_HEADING = /^### 📝 .+ \[#\d+\]\s*$/m;

/** What `arbor merge` prints when it has a todo to propose. */
const PROPOSED = /arbor add <task> --todo \d+/;

/** A numbered list item. */
const NUMBERED = /^\s*\d+\.\s/;

/** What gives a commit away as an agent's: a trailer, a signature or a robot. */
const ATTRIBUTION = [/^co-authored-by:/im, /generated (with|by)/i, /🤖/u];

/** `arbor <verb>` where a shell would run it, with whatever follows. */
const ARBOR =
	/(?:^|[;&|(\n])\s*(?:[A-Z_][A-Z0-9_]*=\S*\s+)*(?:(?:bunx|npx)\s+)?(?:\S*\/)?arbor(?:@\S+)?\s+([a-z]+)([^;&|\n]*)/g;

/** Each `arbor` command `command` runs, by its verb and its words after. */
export function arborCalls(
	command: string,
): { verb: string; args: string[] }[] {
	return [...command.matchAll(ARBOR)].map((match) => ({
		verb: match[1] as string,
		args: words(match[2] as string),
	}));
}

/** `text` split as a shell would, near enough: on spaces, outside quotes. */
function words(text: string): string[] {
	return [...text.matchAll(/'([^']*)'|"((?:\\.|[^"\\])*)"|(\S+)/g)].map(
		(match) => match[1] ?? match[2] ?? match[3] ?? "",
	);
}

/** What each verb prints once it has done its work, after the task's name. */
const DONE = /^(added|merged|removed|escalated) (?!todo \d)(\S+)/gm;

const VERBS = {
	added: "add",
	merged: "merge",
	removed: "remove",
	escalated: "escalate",
} as const;

/** A terminal color code, which arbor prints around what it did. */
const COLOR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** Something an `arbor` command did to a task, read off what it printed. */
interface Event {
	/** Where in the beats it ran. */
	at: number;
	verb: (typeof VERBS)[keyof typeof VERBS];
	task: string;
	/**
	 * For `add`, whether the task is the agent's own: not one handed to
	 * another agent with `--agent`, nor a part with `--base task/…`.
	 */
	own: boolean;
	/** For `escalate`, whether it asked for a review. */
	review: boolean;
	output: string;
}

/**
 * What the `arbor` commands in `beats` did, in order. Read off what each
 * printed rather than whether its command exited 0, since a pipe such as
 * `arbor merge | tail` hides a failure; a command whose output went
 * elsewhere did nothing that can be told.
 */
function events(beats: Beat[]): Event[] {
	return beats.flatMap((beat, at) => {
		// One that sets `ARBOR_HOME` works a throwaway repo, as for a demo.
		if (beat.kind !== "run" || /\bARBOR_HOME=/.test(beat.command)) {
			return [];
		}
		const calls = arborCalls(beat.command);
		const output = beat.output.replace(COLOR, "");
		return [...output.matchAll(DONE)].flatMap((match): Event[] => {
			const verb = VERBS[match[1] as keyof typeof VERBS];
			const task = match[2] as string;
			const call = calls.find((each) => each.verb === verb);
			if (call === undefined) {
				return [];
			}
			const named = calls.find(
				(each) => each.verb === verb && each.args.includes(task),
			);
			const args = (named ?? call).args;
			const base = args[args.indexOf("--base") + 1];
			return [
				{
					at,
					verb,
					task,
					own:
						!args.includes("--agent") &&
						!(args.includes("--base") && base?.startsWith("task/")),
					review: args.includes("--review"),
					output,
				},
			];
		});
	});
}

/** Each task the agent added for itself, where. */
function added(beats: Beat[]): Event[] {
	return events(beats).filter((each) => each.verb === "add" && each.own);
}

/** One turn: from a `user` beat to the next, and the words it ended on. */
interface Turn {
	/** Where it starts in the beats. */
	from: number;
	beats: Beat[];
	/** The last thing it said; empty when it said nothing. */
	report: string;
}

function turns(beats: Beat[]): Turn[] {
	const found: Turn[] = [];
	beats.forEach((beat, at) => {
		if (beat.kind === "user" || found.length === 0) {
			found.push({ from: at, beats: [], report: "" });
		}
		found.at(-1)?.beats.push(beat);
	});
	for (const turn of found) {
		turn.report = said(turn.beats);
	}
	return found;
}

/** The last thing `beats` say; empty when they say nothing. */
function said(beats: Beat[]): string {
	const last = beats.findLast((beat) => beat.kind === "say");
	return last?.kind === "say" ? last.text : "";
}

/** A task ending, with the report it was given. */
interface Ending extends Event {
	verb: "merge" | "remove" | "escalate";
	/**
	 * The last words after it, before the turn ends or another task is
	 * added; empty when there are none.
	 */
	report: string;
}

/** The last task ending in each turn, or each stretch of one before the next `arbor add`. */
function endings(beats: Beat[]): Ending[] {
	const all = events(beats);
	return turns(beats).flatMap(({ from, beats: turn }) => {
		const to = from + turn.length;
		const inTurn = all.filter((each) => each.at >= from && each.at < to);
		return inTurn.flatMap((each, index) => {
			if (each.verb === "add") {
				return [];
			}
			const next = inTurn[index + 1];
			// Ended again before saying anything: the later one has the report.
			if (next !== undefined && next.verb !== "add") {
				return [];
			}
			const until = next?.at ?? to;
			return [
				{
					...each,
					verb: each.verb,
					report: said(beats.slice(each.at + 1, until)),
				},
			];
		});
	});
}

/** What `report` is titled: its first line. */
function titleOf(report: string): string {
	return report.trim().split("\n")[0]?.trim() ?? "";
}

/** The lines of `text` that ask something: ending in `?`, outside code, quotes and headings. */
function questionLines(text: string): string[] {
	let fenced = false;
	return text.split("\n").filter((line) => {
		if (/^\s*(```|~~~)/.test(line)) {
			fenced = !fenced;
			return false;
		}
		const trimmed = line.trim().replace(/\**$/, "");
		return (
			!fenced &&
			trimmed.endsWith("?") &&
			!trimmed.startsWith("#") &&
			!trimmed.startsWith(">")
		);
	});
}

function isPlan(path: string): boolean {
	return path === "ARBOR.md" || path.endsWith("/ARBOR.md");
}

/** A redirect into ARBOR.md, an edit in place, or a script that writes a file. */
const WRITES =
	/>>?[^;&|\n]*ARBOR\.md|\btee\b[^;&|\n]*ARBOR\.md|\s-i\b|\.write(_text)?\(|open\([^)]*,\s*['"][wa]/;

/** Whether `beat` writes ARBOR.md, with an edit or a shell redirect. */
function writesPlan(beat: Beat): boolean {
	if (beat.kind === "edit") {
		return beat.paths.some(isPlan);
	}
	return (
		beat.kind === "run" &&
		beat.command.includes("ARBOR.md") &&
		WRITES.test(beat.command)
	);
}
