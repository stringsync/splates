import { type Demo, demoAt, isDemoTitle } from "./demo";
import { offers, type Question, settled } from "./plan";

/**
 * A stretch of an agent's message: markdown as it was written, the questions
 * it asks the person in the arbor skill's format, its report asking them to
 * review a task before it merges, its report of how a task ended or what it
 * waits on, its word that it added a task, a todo it proposes, or a demo for
 * the person to try.
 */
export type Stretch =
	| { type: "text"; text: string }
	| { type: "questions"; questions: Question[] }
	| { type: "review"; review: Review }
	| { type: "report"; report: Report }
	| { type: "start"; start: Start }
	| { type: "todo"; todo: Proposal }
	| { type: "demo"; demo: Demo };

/** A review the skill's `## 🔍 Ready to merge` report asks for. */
export interface Review {
	task: string;
	base: string;
	/** What changed, and what to look at and where, as markdown. */
	body: string;
	/** The demo it holds, to try before merging. */
	demo: Demo | null;
}

/** How a task ended, or what it waits on, as the skill's reports title it. */
export type Ending = "merged" | "removed" | "escalated";

/**
 * A report the skill titles `## ✅ Merged <task> onto <base>`, `## 🛑 Removed
 * <task>: <why>`, or `## ⚠️ Escalated <task>: <what it needs>`.
 */
export interface Report {
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

/** A task the skill says it added as `## 🌱 Added <task>`, its Goal under it. */
export interface Start {
	task: string;
	/** What done means, as the task's Goal says, as markdown. */
	goal: string;
}

/** A todo the skill proposes as `### 📝 <subject> [#<id>]`. */
export interface Proposal {
	id: number;
	/** The subject as the agent wrote it, which may since have changed. */
	subject: string;
	/** What the todo is and why it matters now, as markdown. */
	body: string;
}

const MERGED = /^## ✅ Merged (\S+) onto (\S+)[ \t]*$/;
const ENDED =
	/^## (?:(🛑) Removed|⚠\uFE0F? Escalated) (\S+?)(?::[ \t]*(.*?))?[ \t]*$/;
const ADDED = /^## 🌱 Added (\S+)[ \t]*$/;
const PROPOSAL = /^### 📝 (.+?) \[#(\d+)\][ \t]*$/;
const HEADING = /^#{1,6}[ \t]/;

/** A review report's title, and the line every one ends with. */
const REVIEW = /^## 🔍 Ready to merge (\S+) onto (\S+)[ \t]*$/;
const REVIEW_END = 'Reply "merge", or say what to change.';

/** An item of a numbered list, at the margin: `2. How should …?`. */
const ITEM = /^(\d+)\.[ \t]+(.+)$/;
const FENCE = /^[ \t]*(```|~~~)/;
/** An item's line that asks: it ends in `?`, or in `?` and an aside. */
const ASKS = /\?(?:[ \t]+\([^()]*\))?$/;
/**
 * An item's line that goes on past its question: `How should I …? You turned
 * down …`, split after the first `?` (and any aside) that a space follows.
 */
const ASKS_THEN = /^(.*?\?(?:[ \t]+\([^()]*\))?)[ \t]+(\S.*)$/;

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
					...withDemo(lines.slice(i + 1, end)),
				},
			});
			from = end + 1;
			i = end;
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
 * The report, added task or proposed todo titled at `start`, which runs until
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
	const added = ADDED.exec(line);
	const proposed = PROPOSAL.exec(line);
	if (
		merged === null &&
		ended === null &&
		added === null &&
		proposed === null
	) {
		return null;
	}
	const end = endAt(lines, start + 1);
	const body = lines
		.slice(start + 1, end)
		.join("\n")
		.replace(/^\n+|\s+$/g, "");
	if (added !== null) {
		return {
			stretch: {
				type: "start",
				start: { task: added[1] as string, goal: body },
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
		merged !== null
			? {
					ending: "merged",
					task: merged[1] as string,
					base: merged[2] as string,
					reason: null,
					body,
					source,
				}
			: {
					ending: ended?.[1] === undefined ? "escalated" : "removed",
					task: ended?.[2] as string,
					base: null,
					reason: ended?.[3] || null,
					body,
					source,
				};
	return { stretch: { type: "report", report }, end };
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
