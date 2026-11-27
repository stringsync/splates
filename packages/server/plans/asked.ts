import {
	asksPermission,
	type PermissionProposal,
	permissionOf,
} from "./permission";
import { offers, type Question, settled, sized } from "./plan";
import {
	groupQueued,
	isQueuedTitle,
	type QueuedCard,
	queuedCardOf,
} from "./queued";
import { isStepsTitle, type Steps, stepsOf } from "./steps";

/**
 * Cuts `text` into the stretches an agent's message holds: prose, questions,
 * reports, reviews and the rest. Questions are a list numbered from 1 at the
 * margin, outside code blocks, each item a line ending in `?` (or `?` and a
 * parenthesised aside), going on past a `?`, or offering `- (a)` or `- [a]`
 * choices. Any other list is only text.
 */
export function stretches(text: string): Stretch[] {
	const held = CUT.get(text);
	if (held !== undefined) {
		return held;
	}
	const found = cut(text);
	// The oldest goes first once full: a page asks it of each conversation's
	// last words on every change, and most are the same words as the time before.
	if (CUT.size >= CUT_HELD) {
		CUT.delete(CUT.keys().next().value as string);
	}
	CUT.set(text, found);
	return found;
}

const CUT = new Map<string, Stretch[]>();
const CUT_HELD = 256;

function cut(text: string): Stretch[] {
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
		if (title !== null) {
			const end = reviewEnd(lines, i);
			found.push(...prose(lines.slice(from, i)));
			found.push({
				type: "review",
				review: {
					task: title[1] as string,
					base: title[2] as string,
					...reviewOf(lines.slice(i + 1, end.body)),
				},
			});
			from = end.next;
			i = end.next - 1;
			continue;
		}
		const plan = planHere(lines, i);
		if (plan !== null) {
			found.push(...prose(lines.slice(from, i)));
			found.push({ type: "plan", plan: plan.plan });
			from = plan.end;
			i = plan.end - 1;
			continue;
		}
		const steps = stepsHere(lines, i);
		if (steps !== null) {
			found.push(...prose(lines.slice(from, i)));
			found.push({ type: "steps", steps: steps.steps });
			from = steps.end;
			i = steps.end - 1;
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
		const list = listAt(lines, i, found.at(-1)?.type === "plan");
		if (list === null) {
			continue;
		}
		found.push(...prose(lines.slice(from, i)));
		found.push({ type: "questions", questions: list.questions });
		from = list.end;
		i = list.end - 1;
	}
	found.push(...prose(lines.slice(from)));
	return groupQueued(
		found,
		(each) => (each.type === "queued" ? each.queued : null),
		(queued): Stretch => ({ type: "queued", queued }),
	);
}

/**
 * A stretch of an agent's message: markdown as it was written, the questions
 * it asks the person in the splates skill's format, its report asking them to
 * review a task before it merges, its report of how a
 * task ended or what it waits on, a permission it asks the person
 * to give, or steps for them to follow.
 */
export type Stretch =
	| { type: "text"; text: string }
	| { type: "questions"; questions: Question[] }
	| { type: "review"; review: Review }
	| { type: "report"; report: TaskReport }
	| { type: "permission"; permission: PermissionProposal }
	| { type: "queued"; queued: QueuedCard }
	| { type: "steps"; steps: Steps }
	| { type: "plan"; plan: PlanCard };

/**
 * A plan the skill titles `## 📝 Plan: <title>`, written however the agent
 * plans, which the questions after it, its approval question last, decide.
 */
export interface PlanCard {
	title: string;
	/** Everything it says under its title, as markdown. */
	body: string;
}

/** A review the skill's `## 🔍 Ready to merge` report asks for. */
export interface Review {
	task: string;
	base: string;
	/** Its first paragraph: what changed, in a sentence, as markdown. */
	summary: string;
	/** The commands its `Checks:` line says passed, in order. */
	checks: string[];
	/** The commands its `Failed:` line says failed, in order. */
	failed: string[];
	/** Whatever else it says, past the summary, as markdown. */
	details: string;
}

/** How a task ended, or what it waits on, as the skill's reports title them. */
export type Ending = "merged" | "done" | "removed" | "deferred" | "escalated";

/**
 * A report the skill titles `## ✅ Merged <task> onto <base>`, `## ✅ Done:
 * <what came of it>` (work over with no task, such as an automation's run), `## 🧹 Removed
 * <task>: <why>`, `## ⏸ Blocked <task>: <what it waits on>`, `## ⚠️ Escalated <task>: <what it needs>`.
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
	/^## (?:(🧹) Removed|(⏸)\uFE0F? (?:Blocked|Deferred)|⚠\uFE0F? Escalated) (\S+?)(?::[ \t]*(.*?))?[ \t]*$/;
/**
 * A heading that ends a card: `#` to `###`. Deeper ones, `####`, are sections
 * within its body.
 */
const HEADING = /^#{1,3}[ \t]/;

/** A review report's title, and the line older ones ended with. */
const REVIEW = /^## 🔍 Ready to merge (\S+) onto (\S+)[ \t]*$/;
const REVIEW_END = 'Reply "merge", or say what to change.';

/**
 * Where the review titled at `start` ends: at the next heading outside a
 * fence, or the end of the reply. An older review's last line, which the
 * card no longer needs, ends it too and is left out of it.
 */
function reviewEnd(
	lines: string[],
	start: number,
): { body: number; next: number } {
	let fenced = false;
	for (let i = start + 1; i < lines.length; i += 1) {
		const line = lines[i] as string;
		if (FENCE.test(line)) {
			fenced = !fenced;
			continue;
		}
		if (fenced) {
			continue;
		}
		if (line.trim() === REVIEW_END) {
			return { body: i, next: i + 1 };
		}
		if (HEADING.test(line)) {
			return { body: i, next: i };
		}
	}
	return { body: lines.length, next: lines.length };
}
/** A review's line naming the checks that passed, each in a code span. */
const CHECKS = /^Checks:[ \t]*(.*)$/;
/** A review's line naming the checks that failed, the same way. */
const FAILED = /^Failed:[ \t]*(.*)$/;

/** An item of a numbered list, at the margin: `2. How should …?`. */
const ITEM = /^(\d+)\.[ \t]+(.+)$/;
const FENCE = /^[ \t]*(```|~~~)/;

/**
 * The report or permission titled at `start`, which runs until
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
	const asking = asksPermission(line);
	if (isQueuedTitle(line)) {
		const at = endAt(lines, start + 1);
		const queued = queuedCardOf(line, lines.slice(start + 1, at).join("\n"));
		return queued === null
			? null
			: { stretch: { type: "queued", queued }, end: at };
	}
	if (!asking && merged === null && done === null && ended === null) {
		return null;
	}
	const end = endAt(lines, start + 1);
	const body = lines
		.slice(start + 1, end)
		.join("\n")
		.replace(/^\n+|\s+$/g, "");
	if (asking) {
		return {
			stretch: {
				type: "permission",
				permission: permissionOf(line, body) as PermissionProposal,
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
 * What a review's `lines` say: its first paragraph, its checks taken out,
 * and the rest.
 */
function reviewOf(
	lines: string[],
): Pick<Review, "summary" | "checks" | "failed" | "details"> {
	let rest = trimmed(lines).split("\n");
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
		checks,
		failed,
		details: gap === -1 ? "" : trimmed(rest.slice(gap)),
	};
}

/**
 * The Steps card titled at `start`, up to the next heading or a list of
 * questions after its own list, and the line after it; null for any other
 * line, or a title with no steps under it.
 */
/** A plan's title: `## 📝 Plan: <title>`. */
const PLAN_TITLE = /^## 📝\uFE0F?[ \t]+Plan(?::[ \t]*(.*?))?[ \t]*$/;
/** A card's title, opened by an emoji, which ends a plan before it. */
const CARD_TITLE = /^## \P{ASCII}/u;

/**
 * The plan titled at `start`, which runs to the questions that decide it,
 * the next card, or the end, and the line after it; null for any other line.
 * Its own headings and lists are its body, whatever the agent plans with.
 */
function planHere(
	lines: string[],
	start: number,
): { plan: PlanCard; end: number } | null {
	const title = PLAN_TITLE.exec(lines[start] as string);
	if (title === null) {
		return null;
	}
	let end = lines.length;
	let fenced = false;
	for (let i = start + 1; i < lines.length; i += 1) {
		const line = lines[i] as string;
		if (FENCE.test(line)) {
			fenced = !fenced;
			continue;
		}
		if (fenced) {
			continue;
		}
		if (
			CARD_TITLE.test(line) ||
			(ITEM.exec(line)?.[1] === "1" && listAt(lines, i) !== null)
		) {
			end = i;
			break;
		}
	}
	return {
		plan: {
			title: (title[1] ?? "").trim(),
			body: lines
				.slice(start + 1, end)
				.join("\n")
				.replace(/^\n+|\s+$/g, ""),
		},
		end,
	};
}

function stepsHere(
	lines: string[],
	start: number,
): { steps: Steps; end: number } | null {
	if (!isStepsTitle(lines[start] as string)) {
		return null;
	}
	let end = lines.length;
	let fenced = false;
	let listed = false;
	for (let i = start + 1; i < lines.length; i += 1) {
		const line = lines[i] as string;
		if (FENCE.test(line)) {
			fenced = !fenced;
			continue;
		}
		if (fenced) {
			continue;
		}
		if (HEADING.test(line)) {
			end = i;
			break;
		}
		// Its own list may read as questions, as a step that ends in `?`;
		// only a list after it is the questions that follow the card.
		if (ITEM.exec(line)?.[1] === "1") {
			if (listed && listAt(lines, i) !== null) {
				end = i;
				break;
			}
			listed = true;
		}
	}
	const steps = stepsOf(lines.slice(start, end));
	return steps === null ? null : { steps, end };
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
	planned = false,
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
	if (!planned) {
		return {
			questions: items.map(({ asked, body }) => settled(asked, body)),
			end,
		};
	}
	const questions = items.map(({ asked, body }) => settled(asked, body));
	// The approval question is the one that blocks, so it reads last,
	// whatever order it was written in. Numbers stay: a reply goes by them.
	const approval = questions.filter((each) => APPROVAL.test(each.text));
	return {
		questions: [
			...questions.filter((each) => !APPROVAL.test(each.text)),
			...approval,
		],
		end,
	};
}

/** An approval question: `Do you approve <the change, named>?`. */
const APPROVAL = /^Do you approve\b/;

/** A plan's approval question: `Do you approve <the change>?` with a Yes. */
export interface Approval {
	/** Its position among the plan's questions: always the last. */
	at: number;
	/** The key of its Yes choice. */
	yes: string;
	/** What it approves: the question with `Do you approve` and `?` dropped. */
	change: string;
}

/**
 * The approval question ending a plan's `questions`, when its last asks
 * `Do you approve ...?` and offers a Yes; null otherwise.
 */
export function approvalOf(questions: Question[]): Approval | null {
	const at = questions.length - 1;
	const asked = questions[at];
	if (asked === undefined || !APPROVAL.test(asked.text)) {
		return null;
	}
	const yes = asked.choices.find((choice) => /^yes\b/i.test(choice.text));
	if (yes === undefined) {
		return null;
	}
	const change = asked.text
		.replace(/^Do you approve\s*/, "")
		.replace(/\?\s*$/, "")
		.trim();
	return { at, yes: yes.key, change };
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
