import { type Demo, demoAt, isDemoTitle } from "./demo";
import { offers, type Question, settled, sized } from "./plan";

/**
 * `text` cut where it asks questions: a list numbered from 1 at the margin,
 * outside code blocks, every item a question, the lines indented under each
 * its body and its `- (a)` or `- [a]` choices, read as `## Blocked` reads
 * them. An item is a question when its line ends in `?`, or in `?` and an
 * aside in parentheses: `(all that apply)`; when it goes on past a `?`, which
 * leaves the rest to its body; or when it offers choices. Any other list is
 * only text.
 */
export function stretches(text: string): Stretch[] {
	const lines = text.split("\n");
	const found: Stretch[] = [];
	let from = 0;
	let fenced = false;
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i] as string;
		if (FENCE.test(line)) {
			fenced = !fenced;
			continue;
		}
		if (fenced) {
			continue;
		}
		const title = REVIEW.exec(line);
		const end = lines.findIndex(
			(each, at) => at > i && each.trim() === REVIEW_END,
		);
		if (title !== null && end !== -1) {
			found.push(...prose(lines.slice(from, i)));
			found.push({
				type: "review",
				review: {
					task: title[1] as string,
					base: title[2] as string,
					...reviewOf(lines.slice(i + 1, end)),
				},
			});
			from = end + 1;
			i = end;
			continue;
		}
		const proposed = PROPOSED.exec(line);
		if (proposed !== null) {
			const end = endAt(lines, i + 1);
			found.push(...prose(lines.slice(from, i)));
			found.push({
				type: "proposal",
				proposal: {
					subject: proposed[1] as string,
					body: trimmed(lines.slice(i + 1, end)),
				},
			});
			from = end;
			i = end - 1;
			continue;
		}
		const demo = demoHere(lines, i);
		if (demo !== null) {
			found.push(...prose(lines.slice(from, i)));
			found.push({ type: "demo", demo: demo.demo });
			from = demo.end;
			i = demo.end - 1;
			continue;
		}
		const kept = keptAt(lines, i);
		if (kept !== null) {
			found.push(...prose(lines.slice(from, i)));
			found.push(kept.stretch);
			from = kept.end;
			i = kept.end - 1;
			continue;
		}
		if (ITEM.exec(line)?.[1] !== "1") {
			continue;
		}
		const list = listAt(lines, i);
		if (list === null) {
			continue;
		}
		found.push(...prose(lines.slice(from, i)));
		found.push({ type: "questions", questions: list.questions });
		from = list.end;
		i = list.end - 1;
	}
	found.push(...prose(lines.slice(from)));
	return found;
}

/**
 * A stretch of an agent's message: markdown as it was written, the questions
 * it asks the person in the splates skill's format, its report asking them to
 * review a task before it merges, a design it proposes, its report of how a
 * task ended or what it waits on, a task it proposes, a permission it asks the person
 * to give, or a demo for the person to try.
 */
export type Stretch =
	| { type: "text"; text: string }
	| { type: "questions"; questions: Question[] }
	| { type: "review"; review: Review }
	| { type: "proposal"; proposal: Proposal }
	| { type: "report"; report: TaskReport }
	| { type: "todo"; todo: TodoProposal }
	| { type: "permission"; permission: PermissionProposal }
	| { type: "demo"; demo: Demo };

/** A review the skill's `## 🔍 Ready to merge` report asks for. */
export interface Review {
	task: string;
	base: string;
	/** Its first paragraph: what changed, in a sentence, as markdown. */
	summary: string;
	/** The demo it holds, to try before merging. */
	demo: Demo | null;
	/** The commands its `Checks:` line says passed, in order. */
	checks: string[];
	/** The commands its `Failed:` line says failed, in order. */
	failed: string[];
	/** Whatever else it says, past the summary, as markdown. */
	details: string;
}

/**
 * What the agent proposes to do, as the skill's `## 💡 Proposed` report puts
 * it, for the person to approve before it starts. The questions after it are
 * the calls it rests on, those with a `(chosen)` choice already answered.
 */
export interface Proposal {
	/** What it proposes, as its title says. */
	subject: string;
	/** What it recommends, and the `####` sections saying why, as markdown. */
	body: string;
}

/** How a task ended, or what it waits on, as the skill's reports title them. */
export type Ending =
	| "merged"
	| "done"
	| "removed"
	| "deferred"
	| "escalated"
	| "working";

/**
 * A report the skill titles `## ✅ Merged <task> onto <base>`, `## ✅ Done:
 * <what came of it>` (work over with no task, such as an automation's run), `## 🛑 Removed
 * <task>: <why>`, `## ⏸ Deferred <task>: <what it waits on>`, `## ⚠️ Escalated <task>: <what it needs>`, or `## ⏳
 * Working <task>: on <agent>`.
 */
export interface TaskReport {
	ending: Ending;
	task: string;
	/** Where it merged; null for the others. */
	base: string | null;
	/** What the title says after its colon, if anything. */
	reason: string | null;
	/** What changed, and anything else said before what follows, as markdown. */
	body: string;
	/** The markdown the agent wrote for it, from its title to its end. */
	source: string;
}

/** A queued task the skill proposes as `### 📝 <subject> [#<id>]`. */
export interface TodoProposal {
	id: number;
	/** The subject as the agent wrote it, which may since have changed. */
	subject: string;
	/** What the task is and why it matters now, as markdown. */
	body: string;
}

/**
 * What the agent asks the person to allow, as the skill's `## 🔐 Permission:
 * queue lane <n>: <name>`, `## 🔐 Permission: queue #<n>, #<n>: <what>` or `##
 * 🔐 Permission: remove lane <n>: <name>` puts it: an agent never does these
 * itself, so the card's buttons are the person's. The older `## 📥 Queue ...`
 * titles read as the queue ones.
 */
export interface PermissionProposal {
	/**
	 * What it asks: queue work, remove a lane with its tasks, run evals, or
	 * run a command whose cost is not compute: tokens, a write outside the repository.
	 */
	action: "queue" | "remove-lane" | "run-evals" | "run-command";
	/** The lane it acts on whole; null for tasks named one by one. */
	lane: number | null;
	/** The tasks named one by one; none for a lane. */
	tasks: number[];
	/** What the title says after its colon, if anything. */
	title: string | null;
	/** What it comes to, as markdown. */
	body: string;
	/** For `run-evals`: what to run, from the card's probe list. */
	evals?: EvalAsk;
	/** For `run-command`: the command to run, from the first backticked line. */
	command?: string;
}

/**
 * The evals a `## 🔐 Permission: run evals <skill>: <what it checks>` card
 * asks to run: the probes it picked, one `` - `probe-id` `` item each, and
 * optionally the revision the skill's change is judged against, as a
 * `` Baseline: `rev` `` line.
 */
export interface EvalAsk {
	skill: string;
	probes: string[];
	baseline: string | null;
}

/** An item's line that asks: it ends in `?`, or in `?` and an aside. */
const ASKS = /\?(?:[ \t]+\([^()]*\))?$/;
/**
 * An item's line that goes on past its question: `How should I …? You turned
 * down …`, split after the first `?` (and any aside) that a space follows.
 */
const ASKS_THEN = /^(.*?\?(?:[ \t]+\([^()]*\))?)[ \t]+(\S.*)$/;

const MERGED = /^## ✅ Merged (\S+) onto (\S+)[ \t]*$/;
/** A conversation's work is over with no task: `## ✅ Done: <what came of it>`. */
const DONE = /^## ✅ Done(?::[ \t]*(.*?))?[ \t]*$/;
const ENDED =
	/^## (?:(🛑) Removed|(⏸)\uFE0F? Deferred|⚠\uFE0F? Escalated) (\S+?)(?::[ \t]*(.*?))?[ \t]*$/;
/** A task handed to another agent, which reports back: `on <agent>` after the colon. */
const WORKING_TASK = /^## ⏳ Working (\S+?)(?::[ \t]*(.*?))?[ \t]*$/;
const PROPOSAL = /^### 📝 (.+?) \[#(\d+)\][ \t]*$/;
const EVALS_PERMISSION =
	/^## 🔐 Permission: run evals (\S+?)(?::[ \t]*(.*?))?[ \t]*$/;
/** A run-evals card's probe: a list item that is one code span, then maybe a note. */
const EVAL_PROBE = /^[-*][ \t]+`([^`\s]+)`(?:[ \t].*)?$/;
const EVAL_BASELINE = /^Baseline:[ \t]*`([^`\s]+)`[ \t]*$/;
const RUN_PERMISSION = /^## 🔐 Permission: run command(?::[ \t]*(.*?))?[ \t]*$/;
/** A run-command card's command: a line that is one code span. */
const RUN_COMMAND = /^`([^`\n]+)`[ \t]*$/;
const PERMISSION =
	/^## (?:🔐 Permission: (?:(remove) lane (\d+)|queue (?:lane (\d+)|(#\d+(?:,[ \t]*#\d+)*)))|📥 Queue (?:lane (\d+)|(#\d+(?:,[ \t]*#\d+)*)))(?::[ \t]*(.*?))?[ \t]*$/;
/**
 * A queue card's line of the command that queues its work from a terminal,
 * `` `splates lane queue 7` ``, which the card shows on its own row.
 */
const COMMAND_LINE = /^`splates [^`\n]+`[ \t]*$/gm;
/**
 * A heading that ends a card: `#` to `###`. Deeper ones, `####`, are sections
 * within its body.
 */
const HEADING = /^#{1,3}[ \t]/;

/** A review report's title, and the line every one ends with. */
const REVIEW = /^## 🔍 Ready to merge (\S+) onto (\S+)[ \t]*$/;
const REVIEW_END = 'Reply "merge", or say what to change.';
/** A proposal's title. */
const PROPOSED = /^## 💡 Proposed (.+?)[ \t]*$/;
/** A review's line naming the checks that passed, each in a code span. */
const CHECKS = /^Checks:[ \t]*(.*)$/;
/** A review's line naming the checks that failed, the same way. */
const FAILED = /^Failed:[ \t]*(.*)$/;

/** An item of a numbered list, at the margin: `2. How should …?`. */
const ITEM = /^(\d+)\.[ \t]+(.+)$/;
const FENCE = /^[ \t]*(```|~~~)/;

/**
 * The report, proposed task or work to queue titled at `start`, which runs until
 * whatever begins next, and the line after it; null for any
 * other line.
 */
function keptAt(
	lines: string[],
	start: number,
): { stretch: Stretch; end: number } | null {
	const line = lines[start] as string;
	const merged = MERGED.exec(line);
	const done = DONE.exec(line);
	const ended = ENDED.exec(line);
	const workingTask = WORKING_TASK.exec(line);
	const proposed = PROPOSAL.exec(line);
	const permission = PERMISSION.exec(line);
	const evals = EVALS_PERMISSION.exec(line);
	const run = RUN_PERMISSION.exec(line);
	if (
		permission === null &&
		evals === null &&
		run === null &&
		merged === null &&
		done === null &&
		ended === null &&
		workingTask === null &&
		proposed === null
	) {
		return null;
	}
	const end =
		proposed !== null
			? paragraphEnd(lines, start + 1, endAt(lines, start + 1))
			: endAt(lines, start + 1);
	const body = lines
		.slice(start + 1, end)
		.join("\n")
		.replace(/^\n+|\s+$/g, "");
	if (run !== null) {
		const rows = body.split("\n");
		const at = rows.findIndex((each) => RUN_COMMAND.test(each));
		const command =
			at < 0 ? "" : (RUN_COMMAND.exec(rows[at] as string)?.[1] as string);
		return {
			stretch: {
				type: "permission",
				permission: {
					action: "run-command",
					lane: null,
					tasks: [],
					title: run[1] || null,
					body: rows
						.filter((_, index) => index !== at)
						.join("\n")
						.replace(/^\n+|\s+$/g, ""),
					command,
				},
			},
			end,
		};
	}
	if (evals !== null) {
		const probes: string[] = [];
		let baseline: string | null = null;
		const prose = body.split("\n").filter((each) => {
			const probe = EVAL_PROBE.exec(each);
			if (probe !== null) {
				probes.push(probe[1] as string);
				return false;
			}
			const base = EVAL_BASELINE.exec(each);
			if (base !== null) {
				baseline = base[1] as string;
				return false;
			}
			return true;
		});
		return {
			stretch: {
				type: "permission",
				permission: {
					action: "run-evals",
					lane: null,
					tasks: [],
					title: evals[2] || null,
					body: prose.join("\n").replace(/^\n+|\s+$/g, ""),
					evals: { skill: evals[1] as string, probes, baseline },
				},
			},
			end,
		};
	}
	if (permission !== null) {
		const lane = permission[2] ?? permission[3] ?? permission[5];
		return {
			stretch: {
				type: "permission",
				permission: {
					action: permission[1] === undefined ? "queue" : "remove-lane",
					lane: lane === undefined ? null : Number(lane),
					tasks: Array.from(
						(permission[4] ?? permission[6] ?? "").matchAll(/\d+/g),
						Number,
					),
					title: permission[7] || null,
					body: body.replace(COMMAND_LINE, "").replace(/^\n+|\s+$/g, ""),
				},
			},
			end,
		};
	}
	if (proposed !== null) {
		return {
			stretch: {
				type: "todo",
				todo: {
					id: Number(proposed[2]),
					subject: proposed[1] as string,
					body,
				},
			},
			end,
		};
	}
	const source = lines.slice(start, end).join("\n").replace(/\s+$/, "");
	const report: TaskReport =
		merged !== null
			? {
					ending: "merged",
					task: merged[1] as string,
					base: merged[2] as string,
					reason: null,
					body,
					source,
				}
			: done !== null
				? {
						ending: "done",
						task: "",
						base: null,
						reason: done[1] || null,
						body,
						source,
					}
				: workingTask !== null
					? {
							ending: "working",
							task: workingTask[1] as string,
							base: null,
							reason: workingTask[2] || null,
							body,
							source,
						}
					: {
							ending:
								ended?.[1] !== undefined
									? "removed"
									: ended?.[2] !== undefined
										? "deferred"
										: "escalated",
							task: ended?.[3] as string,
							base: null,
							reason: ended?.[4] || null,
							body,
							source,
						};
	return { stretch: { type: "report", report }, end };
}

/**
 * What a review's `lines` say: its first paragraph, its demo and its checks
 * taken out, and the rest.
 */
function reviewOf(
	lines: string[],
): Pick<Review, "summary" | "demo" | "checks" | "failed" | "details"> {
	const { body, demo } = withDemo(lines);
	let rest = body.split("\n");
	// Each line naming checks taken out, along with the blank line after it,
	// so no gap is left doubled.
	const named = (line: RegExp): string[] => {
		const at = rest.findIndex((said) => line.test(said));
		if (at === -1) {
			return [];
		}
		const found = Array.from(
			(rest[at] as string).matchAll(/`([^`]+)`/g),
			(code) => code[1] as string,
		);
		rest = rest.toSpliced(at, rest[at + 1]?.trim() === "" ? 2 : 1);
		return found;
	};
	const checks = named(CHECKS);
	const failed = named(FAILED);
	const gap = rest.findIndex((line) => line.trim() === "");
	return {
		summary: trimmed(gap === -1 ? rest : rest.slice(0, gap)),
		demo,
		checks,
		failed,
		details: gap === -1 ? "" : trimmed(rest.slice(gap)),
	};
}

/**
 * A review's `lines`: what they say, with the demo among them taken out,
 * along with anything after it.
 */
function withDemo(lines: string[]): { body: string; demo: Demo | null } {
	const at = lines.findIndex((_, index) => demoHere(lines, index) !== null);
	const found = at === -1 ? null : demoHere(lines, at);
	if (found === null) {
		return { body: trimmed(lines), demo: null };
	}
	return {
		body: trimmed([...lines.slice(0, at), ...lines.slice(found.end)]),
		demo: found.demo,
	};
}

/**
 * The demo titled at `start`, up to the next heading or list of questions;
 * null for any other line.
 */
function demoHere(
	lines: string[],
	start: number,
): { demo: Demo; end: number } | null {
	return isDemoTitle(lines[start] as string)
		? demoAt(lines, start, endAt(lines, start + 1))
		: null;
}

/** `lines` as one text, without blank lines at either end. */
function trimmed(lines: string[]): string {
	return lines.join("\n").replace(/^\n+|\s+$/g, "");
}

/**
 * The line after the first paragraph from `start`, short of `end`: a
 * proposed task's body is one sentence, so what follows it is the message
 * going on.
 */
function paragraphEnd(lines: string[], start: number, end: number): number {
	let begun = false;
	let fenced = false;
	for (let i = start; i < end; i += 1) {
		const line = lines[i] as string;
		if (FENCE.test(line)) {
			fenced = !fenced;
		}
		if (line.trim() !== "") {
			begun = true;
		} else if (begun && !fenced) {
			return i;
		}
	}
	return end;
}

/**
 * The first line from `start` that begins something else: a heading or a
 * list of questions, outside code blocks; else the end.
 */
function endAt(lines: string[], start: number): number {
	let fenced = false;
	for (let i = start; i < lines.length; i += 1) {
		const line = lines[i] as string;
		if (FENCE.test(line)) {
			fenced = !fenced;
			continue;
		}
		if (
			!fenced &&
			(HEADING.test(line) ||
				(ITEM.exec(line)?.[1] === "1" && listAt(lines, i) !== null))
		) {
			return i;
		}
	}
	return lines.length;
}

/** The questions of the list starting at `start`, and the line after it. */
function listAt(
	lines: string[],
	start: number,
): { questions: Question[]; end: number } | null {
	const items: { asked: Question; body: string[] }[] = [];
	let end = start;
	for (let i = start; i < lines.length; i += 1) {
		const line = lines[i] as string;
		const item = ITEM.exec(line);
		if (item !== null && item[1] === String(items.length + 1)) {
			items.push({ asked: question(item[1], item[2] ?? ""), body: [] });
			end = i + 1;
			continue;
		}
		if (line.trim() === "") {
			continue;
		}
		// Back at the margin, and not the next item: the list is over.
		if (!/^[ \t]/.test(line)) {
			break;
		}
		const last = items.at(-1) as { asked: Question; body: string[] };
		// The blank lines skipped over belong to it too.
		last.body.push(...lines.slice(end, i).map(() => ""));
		if (!offers(last.asked, line)) {
			last.body.push(line);
		}
		end = i + 1;
	}
	if (!items.every(asks)) {
		return null;
	}
	return {
		questions: items.map(({ asked, body }) => settled(asked, body)),
		end,
	};
}

/**
 * Whether an item asks, moving what its line says past its question to the
 * top of its body.
 */
function asks({ asked, body }: { asked: Question; body: string[] }): boolean {
	if (ASKS.test(asked.text)) {
		return true;
	}
	const then = ASKS_THEN.exec(asked.text);
	if (then !== null) {
		asked.text = then[1] as string;
		// Indented past the margin, as it would be under the line.
		const indent = /^[ \t]*/.exec(body.find((line) => line.trim()) ?? "");
		body.unshift(`${indent?.[0] ?? ""}${then[2]}`);
		return true;
	}
	return asked.choices.length > 0;
}

function question(number: string, line: string): Question {
	return {
		number,
		done: false,
		...sized(line.trim()),
		body: "",
		reply: null,
		followUps: [],
		choices: [],
		pick: null,
	};
}

/** `lines` as a stretch of text, or none when they hold nothing. */
function prose(lines: string[]): Stretch[] {
	const text = lines.join("\n").replace(/^\n+|\s+$/g, "");
	return text === "" ? [] : [{ type: "text", text }];
}
