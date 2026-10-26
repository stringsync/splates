/**
 * The rules of the splates skill a program can decide, checked over one
 * conversation: what it said and ran, condensed, and what it left behind.
 * `splates server` runs them on its conversations, for the Stats page's pass rate
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
	/** Whether the conversation's project has notes; absent for older callers. */
	hasNotes?: boolean;
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
		id: "notes-first",
		rule: "Runs splates notes before the first edit when the project has notes",
		judge: ({ beats }, { hasNotes = false }) => {
			const edit = beats.findIndex((beat) => beat.kind === "edit");
			if (edit === -1) {
				return [];
			}
			if (!hasNotes) {
				return [{ ok: true, why: "project has no notes" }];
			}
			const read = beats
				.slice(0, edit)
				.some(
					(beat) =>
						beat.kind === "run" &&
						beat.ok &&
						splatesCalls(beat.command).some(({ verb }) => verb === "notes"),
				);
			return [
				{
					ok: read,
					why: read
						? "splates notes came before the first edit"
						: "edited before running splates notes",
				},
			];
		},
	},
	{
		id: "plan-first",
		rule: "Writes SPLATES.md before the first edit",
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
							? `${task}: SPLATES.md came first`
							: `${task}: edited before writing SPLATES.md`,
					},
				];
			}),
	},
	{
		id: "report-title",
		rule: "Titles a task's report by how it ended",
		judge: ({ beats }) => [
			...endings(beats).map(({ verb, report }) => {
				const title = titleOf(report);
				return {
					ok: TITLES[verb].test(title),
					why: `${verb}: ${title ? `"${title}"` : "no report"}`,
				};
			}),
			...reviews(beats).map((report) => {
				const title = titleOf(report);
				const last = report.trim().split("\n").at(-1)?.trim();
				const titled = TITLES.review.test(title);
				return {
					ok: titled && last === REVIEW_ENDS,
					why:
						titled && last !== REVIEW_ENDS
							? `review: ends "${last}"`
							: `review: "${title}"`,
				};
			}),
		],
	},
	{
		id: "setup-read-first",
		rule: "Reads a setup step before acting on it",
		judge: ({ beats }) =>
			setups(beats).flatMap(({ step, span }) => {
				const first = span.find(
					(beat) =>
						beat.kind === "edit" ||
						(beat.kind === "run" && splatesCalls(beat.command).length > 0),
				);
				if (first === undefined) {
					return [];
				}
				const ok = checks(first, step);
				return [
					{
						ok,
						why: ok
							? `${step}: read it first`
							: `${step}: acted before reading it`,
					},
				];
			}),
	},
	{
		id: "setup-checked",
		rule: "Checks a setup step after each change",
		judge: ({ beats }) =>
			setups(beats).flatMap(({ step, span }) =>
				turns(span).flatMap(({ beats: turn }) => {
					const last = turn.findLastIndex(acts);
					if (last === -1) {
						return [];
					}
					const ok = turn.slice(last + 1).some((beat) => checks(beat, step));
					return [
						{
							ok,
							why: ok
								? `${step}: checked after the last change`
								: `${step}: changed without checking after`,
						},
					];
				}),
			),
	},
	{
		id: "setup-one-step",
		rule: "Stays on the setup step it was asked about",
		judge: ({ beats }) =>
			setups(beats).map(({ step, span }) => {
				const next = span.findIndex(
					(beat, at) => at > 0 && beat.kind === "user",
				);
				const other = (next === -1 ? span : span.slice(0, next))
					.flatMap((beat) =>
						beat.kind === "run" ? splatesCalls(beat.command) : [],
					)
					.flatMap(({ verb, args }) =>
						verb === "setup"
							? args.filter((arg) => !arg.startsWith("-") && arg !== step)
							: [],
					)[0];
				return {
					ok: other === undefined,
					why:
						other === undefined
							? `${step}: kept to it`
							: `${step}: went on to ${other} unasked`,
				};
			}),
	},
];

/** What the Setup page sends to start a conversation on one step. */
const SETUP = /^\s*\[(?:SPLATES|ARBOR) SETUP ([^\]\s]+)\]/;

/**
 * Each setup step a conversation was asked to walk the user through, with
 * the beats from the ask up to the next one.
 */
function setups(beats: Beat[]): { step: string; span: Beat[] }[] {
	const asks = beats.flatMap((beat, at) => {
		const step = beat.kind === "user" ? SETUP.exec(beat.text)?.[1] : undefined;
		return step === undefined ? [] : [{ at, step }];
	});
	return asks.map(({ at, step }, index) => ({
		step,
		span: beats.slice(at, asks[index + 1]?.at ?? beats.length),
	}));
}

/** Whether `beat` reads `step` with `splates setup`, which skipping does too. */
function checks(beat: Beat, step: string): boolean {
	return (
		beat.kind === "run" &&
		splatesCalls(beat.command).some(
			({ verb, args }) => verb === "setup" && args.includes(step),
		)
	);
}

/**
 * Whether `beat` changes something a setup check could see: an edit, or an
 * `splates` command that is not a read. Other shell commands are left out,
 * since a program cannot tell `which claude` from `brew install`.
 */
function acts(beat: Beat): boolean {
	if (beat.kind === "edit") {
		return true;
	}
	return (
		beat.kind === "run" &&
		splatesCalls(beat.command).some(
			({ verb, args }) =>
				verb !== "setup" &&
				!(verb === "creds" && ["wait", "list"].includes(args[0] ?? "")),
		)
	);
}

/** What a task's report is titled, by how it ended. */
const TITLES = {
	merge: /^## ✅ Merged \S+ onto \S+$/,
	remove: /^## (?:🛑 Removed|⏸ Deferred) \S+: .*[^.!?:]$/,
	review: /^## 🔍 Ready to merge \S+ onto \S+$/,
};

/** A heading that asks for a review, wherever in a reply it sits. */
const REVIEW = /^##\s.*Ready to merge\b/m;

/** The line a review ends on, which the page needs to show its Merge button. */
const REVIEW_ENDS = 'Reply "merge", or say what to change.';

/** `splates <verb>` where a shell would run it, with whatever follows. */
const SPLATES =
	/(?:^|[;&|(\n])\s*(?:[A-Z_][A-Z0-9_]*=\S*\s+)*(?:(?:bunx|npx)\s+)?(?:\S*\/)?splates(?:@\S+)?\s+([a-z]+)([^;&|\n]*)/g;

/** Each `splates` command `command` runs, by its verb and its words after. */
export function splatesCalls(
	command: string,
): { verb: string; args: string[] }[] {
	return [...command.matchAll(SPLATES)].map((match) => ({
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
const DONE = /^(added|merged|removed) (?!(?:todo|task) \d)(\S+)/gm;

const VERBS = {
	added: "add",
	merged: "merge",
	removed: "remove",
} as const;

/** A terminal color code, which splates prints around what it did. */
const COLOR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** Something a `splates` command did to a task, read off what it printed. */
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
	output: string;
}

/**
 * What the `splates` commands in `beats` did, in order. Read off what each
 * printed rather than whether its command exited 0, since a pipe such as
 * `splates merge | tail` hides a failure; a command whose output went
 * elsewhere did nothing that can be told.
 */
function events(beats: Beat[]): Event[] {
	return beats.flatMap((beat, at) => {
		// One that sets `SPLATES_HOME` works a throwaway repo, as for a demo.
		if (beat.kind !== "run" || /\bSPLATES_HOME=/.test(beat.command)) {
			return [];
		}
		const calls = splatesCalls(beat.command);
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
	verb: "merge" | "remove";
	/**
	 * The last words after it, before the turn ends or another task is
	 * added; empty when there are none.
	 */
	report: string;
}

/** The last task ending in each turn, or each stretch of one before the next `splates add`. */
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

/** Each turn's last words that ask for a review, by a Ready to merge heading. */
function reviews(beats: Beat[]): string[] {
	return turns(beats)
		.map(({ report }) => report)
		.filter((report) => REVIEW.test(report));
}

/** What `report` is titled: its first line. */
function titleOf(report: string): string {
	return report.trim().split("\n")[0]?.trim() ?? "";
}

function isPlan(path: string): boolean {
	return path === "SPLATES.md" || path.endsWith("/SPLATES.md");
}

/** A redirect into SPLATES.md, an edit in place, or a script that writes a file. */
const WRITES =
	/>>?[^;&|\n]*SPLATES\.md|\btee\b[^;&|\n]*SPLATES\.md|\s-i\b|\.write(_text)?\(|open\([^)]*,\s*['"][wa]/;

/** Whether `beat` writes SPLATES.md, with an edit or a shell redirect. */
function writesPlan(beat: Beat): boolean {
	if (beat.kind === "edit") {
		return beat.paths.some(isPlan);
	}
	return (
		beat.kind === "run" &&
		beat.command.includes("SPLATES.md") &&
		WRITES.test(beat.command)
	);
}
