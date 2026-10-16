import { type Demo, demoAt, isDemoTitle } from "./demo";
import { offers, type Question, settled } from "./plan";

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
 * it asks the person in the arbor skill's format, its report asking them to
 * review a task before it merges, a design it proposes, its report of how a task ended or what it
 * waits on or that the lanes it orchestrated are done, its word that it
 * started lanes, a todo it proposes, a demo for the person to try, or its word that
 * it requested a cred.
 */
export type Stretch =
	| { type: "text"; text: string }
	| { type: "questions"; questions: Question[] }
	| { type: "review"; review: Review }
	| { type: "proposal"; proposal: Proposal }
	| { type: "report"; report: Report }
	| { type: "start"; start: LanesStart }
	| { type: "todo"; todo: TodoProposal }
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

/**
 * How a task ended, or what it waits on, or that a lane orchestrator is done
 * with its lanes or waits on the person, as the skill's reports title them.
 */
export type Ending =
	| "merged"
	| "removed"
	| "escalated"
	| "handed"
	| "finished"
	| "waiting"
	| "working";

/** A report on a task, or a lane orchestrator's last word on its lanes. */
export type Report = TaskReport | LanesReport;

/**
 * A report the skill titles `## ✅ Merged <task> onto <base>`, `## 🛑 Removed
 * <task>: <why>`, `## ⚠️ Escalated <task>: <what it needs>`, `## 🤝 Handed
 * off <task> to <agent>: <why>`, or `## ⏳ Working <task>: on <agent>`, for a
 * task its agent handed on and relays for, as a lane's orchestrator does.
 */
export interface TaskReport {
	ending: Exclude<Ending, "finished" | "waiting">;
	task: string;
	/** Where it merged; null for the others. */
	base: string | null;
	/** The agent it was handed off to; null for the others. */
	to: string | null;
	/** What the title says after its colon, if anything. */
	reason: string | null;
	/** What changed, and anything else said before what follows, as markdown. */
	body: string;
	/** The markdown the agent wrote for it, from its title to its end. */
	source: string;
}

/**
 * The report a lane orchestrator ends on: once every lane it works is done,
 * titled `## 🏁 Finished lanes <name>, <name>`, as there is nothing left for
 * it to hand out; or once each lane not done waits on a task that escalated,
 * titled `## ⏸️ Waiting lanes <name>, <name>: <on what>`, as the person must
 * answer that task before it can go on.
 */
export interface LanesReport {
	ending: "finished" | "waiting" | "working";
	/** The lanes' names, as the title lists them. */
	lanes: string[];
	/** What the title says after its colon, if anything. */
	reason: string | null;
	/** How each lane stands, and anything else said, as markdown. */
	body: string;
	/** The markdown the agent wrote for it, from its title to its end. */
	source: string;
}

/** What an agent says it is starting on: a task, or a lane orchestrator's lanes. */
export type Start = TaskStart | LanesStart;

/** A task arbor added at the agent's word, its Goal from the add event. */
export interface TaskStart {
	task: string;
	/** What done means, as the task's Goal says, as markdown. */
	goal: string;
}

/**
 * The lanes an orchestrator says it is starting to work, as `## 🌱 Started
 * lanes <name>, <name>`, what they add up to under it.
 */
export interface LanesStart {
	/** The lanes' names, as the title lists them. */
	lanes: string[];
	/** What the lanes add up to, as markdown. */
	goal: string;
}

/** A todo the skill proposes as `### 📝 <subject> [#<id>]`. */
export interface TodoProposal {
	id: number;
	/** The subject as the agent wrote it, which may since have changed. */
	subject: string;
	/** What the todo is and why it matters now, as markdown. */
	body: string;
}

/** An item's line that asks: it ends in `?`, or in `?` and an aside. */
const ASKS = /\?(?:[ \t]+\([^()]*\))?$/;
/**
 * An item's line that goes on past its question: `How should I …? You turned
 * down …`, split after the first `?` (and any aside) that a space follows.
 */
const ASKS_THEN = /^(.*?\?(?:[ \t]+\([^()]*\))?)[ \t]+(\S.*)$/;

const MERGED = /^## ✅ Merged (\S+) onto (\S+)[ \t]*$/;
const ENDED =
	/^## (?:(🛑) Removed|⚠\uFE0F? Escalated) (\S+?)(?::[ \t]*(.*?))?[ \t]*$/;
const FINISHED = /^## 🏁 Finished lanes? (.*?)[ \t]*$/;
const WAITING = /^## ⏸\uFE0F? Waiting lanes? (.*?)(?::[ \t]*(.*?))?[ \t]*$/;
const WORKING = /^## ⏳ Working lanes? (.*?)(?::[ \t]*(.*?))?[ \t]*$/;
/** A task handed to another agent, which reports back: `on <agent>` after the colon. */
const WORKING_TASK = /^## ⏳ Working (\S+?)(?::[ \t]*(.*?))?[ \t]*$/;
const HANDED = /^## 🤝 Handed off (\S+) to (.+?)(?::[ \t]*(.*?))?[ \t]*$/;
const STARTED = /^## 🌱 Started lanes? (.*?)[ \t]*$/;
const PROPOSAL = /^### 📝 (.+?) \[#(\d+)\][ \t]*$/;
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
 * The report, started lanes or proposed todo titled at `start`, which runs until
 * the next heading or list of questions, and the line after it; null for any
 * other line.
 */
function keptAt(
	lines: string[],
	start: number,
): { stretch: Stretch; end: number } | null {
	const line = lines[start] as string;
	const merged = MERGED.exec(line);
	const ended = ENDED.exec(line);
	const finished = FINISHED.exec(line);
	const waiting = WAITING.exec(line);
	const working = WORKING.exec(line);
	const workingTask = working === null ? WORKING_TASK.exec(line) : null;
	const handed = HANDED.exec(line);
	const started = STARTED.exec(line);
	const proposed = PROPOSAL.exec(line);
	if (
		merged === null &&
		ended === null &&
		finished === null &&
		waiting === null &&
		working === null &&
		workingTask === null &&
		handed === null &&
		started === null &&
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
	if (started !== null) {
		return {
			stretch: {
				type: "start",
				start: { lanes: lanesOf(started[1] as string), goal: body },
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
	const report: Report =
		finished !== null
			? {
					ending: "finished",
					lanes: lanesOf(finished[1] as string),
					reason: null,
					body,
					source,
				}
			: waiting !== null || working !== null
				? {
						ending: waiting !== null ? "waiting" : "working",
						lanes: lanesOf((waiting ?? working)?.[1] as string),
						reason: (waiting ?? working)?.[2] || null,
						body,
						source,
					}
				: merged !== null
					? {
							ending: "merged",
							task: merged[1] as string,
							base: merged[2] as string,
							to: null,
							reason: null,
							body,
							source,
						}
					: workingTask !== null
						? {
								ending: "working",
								task: workingTask[1] as string,
								base: null,
								to: null,
								reason: workingTask[2] || null,
								body,
								source,
							}
						: handed !== null
							? {
									ending: "handed",
									task: handed[1] as string,
									base: null,
									to: handed[2] as string,
									reason: handed[3] || null,
									body,
									source,
								}
							: {
									ending: ended?.[1] === undefined ? "escalated" : "removed",
									task: ended?.[2] as string,
									base: null,
									to: null,
									reason: ended?.[3] || null,
									body,
									source,
								};
	return { stretch: { type: "report", report }, end };
}

/** The lanes a title lists by name, comma separated. */
function lanesOf(listed: string): string[] {
	return listed
		.split(",")
		.map((lane) => lane.trim())
		.filter((lane) => lane !== "");
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
 * The first line from `start` that begins something else: a heading or a
 * list of questions, outside code blocks; else the end.
 */
/**
 * The line after the first paragraph from `start`, short of `end`: a
 * proposed todo's body is one sentence, so what follows it is the message
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

function question(number: string, text: string): Question {
	return {
		number,
		done: false,
		text: text.trim(),
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
