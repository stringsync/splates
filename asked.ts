import { offers, type Question, settled } from "./plan";

/**
 * A stretch of an agent's message: markdown as it was written, the questions
 * it asks the person in the arbor skill's format, its report asking them to
 * review a task before it merges, its report of how a task ended or what it
 * waits on, a todo it proposes, or a demo for the person to try.
 */
export type Stretch =
	| { type: "text"; text: string }
	| { type: "questions"; questions: Question[] }
	| { type: "review"; review: Review }
	| { type: "report"; report: Report }
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

/**
 * Something to try, as the skill writes it under `### 🎬 Demo: <title>`:
 * where, then numbered steps.
 */
export interface Demo {
	/** What it shows, from its heading; null when the heading says none. */
	title: string | null;
	/** Where to try it and anything said before the steps, as markdown. */
	intro: string;
	steps: Step[];
}

/** A step of a demo: what to do, on its line, and what to see, under it. */
export interface Step {
	number: string;
	action: string;
	/** What should happen, screenshots included, as markdown. */
	expect: string;
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
const PROPOSAL = /^### 📝 (.+?) \[#(\d+)\][ \t]*$/;
const DEMO = /^### 🎬 Demo(?::[ \t]*(.*?))?[ \t]*$/;
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
		const demo = demoAt(lines, i);
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
 * The report or proposed todo titled at `start`, which runs until the next
 * heading or list of questions, and the line after it; null for any other line.
 */
function keptAt(
	lines: string[],
	start: number,
): { stretch: Stretch; end: number } | null {
	const line = lines[start] as string;
	const merged = MERGED.exec(line);
	const ended = ENDED.exec(line);
	const proposed = PROPOSAL.exec(line);
	if (merged === null && ended === null && proposed === null) {
		return null;
	}
	const end = endAt(lines, start + 1);
	const body = lines
		.slice(start + 1, end)
		.join("\n")
		.replace(/^\n+|\s+$/g, "");
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
	const at = lines.findIndex((_, index) => demoAt(lines, index) !== null);
	const found = at === -1 ? null : demoAt(lines, at);
	if (found === null) {
		return { body: trimmed(lines), demo: null };
	}
	return {
		body: trimmed([...lines.slice(0, at), ...lines.slice(found.end)]),
		demo: found.demo,
	};
}

/**
 * The demo titled at `start`: what it says up to its steps, the next
 * heading, or a list of questions, then its steps, and the line after them;
 * null for any other line.
 */
function demoAt(
	lines: string[],
	start: number,
): { demo: Demo; end: number } | null {
	const title = DEMO.exec(lines[start] as string);
	if (title === null) {
		return null;
	}
	const until = endAt(lines, start + 1);
	const first = lines.findIndex(
		(line, at) => at > start && at < until && ITEM.exec(line)?.[1] === "1",
	);
	const steps: Step[] = [];
	let end = first === -1 ? until : first;
	if (first !== -1) {
		let body: string[] = [];
		for (let i = first; i < lines.length; i += 1) {
			const line = lines[i] as string;
			const item = ITEM.exec(line);
			if (item !== null && item[1] === String(steps.length + 1)) {
				body = [];
				steps.push({
					number: item[1],
					action: (item[2] ?? "").trim(),
					expect: "",
				});
				end = i + 1;
				continue;
			}
			if (line.trim() === "") {
				continue;
			}
			// Back at the margin, and not the next step: the steps are over.
			if (!/^[ \t]/.test(line)) {
				break;
			}
			body.push(...lines.slice(end, i).map(() => ""), line);
			(steps.at(-1) as Step).expect = dedented(body);
			end = i + 1;
		}
	}
	return {
		demo: {
			title: title[1] || null,
			intro: trimmed(lines.slice(start + 1, first === -1 ? until : first)),
			steps,
		},
		end,
	};
}

/** `lines` without the indent they share, as markdown of their own. */
function dedented(lines: string[]): string {
	const indent = Math.min(
		...lines
			.filter((line) => line.trim() !== "")
			.map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0),
	);
	return trimmed(lines.map((line) => line.slice(indent)));
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

/** What a reply says to one question: the letters it picks, then its words. */
export interface Answer {
	picks: string[];
	words: string;
}

/**
 * The question an answer is for: its number, its line, and the letters it
 * offers and how they are picked.
 */
type Asked = Pick<Question, "number" | "text" | "choices" | "pick">;

/** A question's line, quoted in a reply: `> **How should …?**`. */
const QUOTED = /^> \*\*(.+)\*\*[ \t]*$/;
/** A pick under a quoted question: `- (b) …`, or in order, `2. (b) …`. */
const PICKED = /^(?:-|\d+\.)[ \t]+\(([a-z])\)(?=[ \t]|$)/;

/**
 * `answers` to `questions` as a reply, quote and reply: what else the person
 * says first, then each question answered, its line quoted in bold, its picks
 * under it as a list spelled out with their text, numbered when in order, and
 * then its words. Unanswered questions are left out, so nothing in the reply
 * goes by a number or a letter alone.
 */
export function replyOf(
	questions: Asked[],
	answers: (Answer | null)[],
	more: string,
): string {
	const parts = more.trim() === "" ? [] : [escaped(more.trim(), [])];
	questions.forEach((asked, at) => {
		const answer = answers[at] ?? null;
		if (answer === null || isEmpty(answer)) {
			return;
		}
		const picks = answer.picks.map((key, index) => {
			const choice = asked.choices.find((each) => each.key === key);
			const mark = asked.pick === "order" ? `${index + 1}.` : "-";
			return `${mark} (${key}) ${choice?.text ?? ""}`.trimEnd();
		});
		parts.push(
			[
				`> **${asked.text}**`,
				picks.join("\n"),
				escaped(answer.words.trim(), asked.choices),
			]
				.filter((part) => part !== "")
				.join("\n\n"),
		);
	});
	return parts.join("\n\n");
}

/** Whether `answer` says nothing: no picks, and no words but spaces. */
export function isEmpty(answer: Answer): boolean {
	return answer.picks.length === 0 && answer.words.trim() === "";
}

/**
 * `words` with a `\` before each line that would read as a quoted question,
 * or, first, as a pick of `choices`, so they read back as words.
 */
function escaped(words: string, choices: Asked["choices"]): string {
	return words
		.split("\n")
		.map((line, at) =>
			QUOTED.test(line) || (at === 0 && picked(line, choices) !== null)
				? `\\${line}`
				: line,
		)
		.join("\n");
}

/** `line` without the `\` that `escaped` put before it. */
function unescaped(line: string): string {
	const rest = line.slice(1);
	return line.startsWith("\\") && (QUOTED.test(rest) || PICKED.test(rest))
		? rest
		: line;
}

/** The letter `line` picks among `choices`, or null when it picks none. */
function picked(line: string, choices: Asked["choices"]): string | null {
	const key = PICKED.exec(line)?.[1];
	return choices.some((choice) => choice.key === key) ? (key ?? null) : null;
}

/** The same question's line, give or take spacing and case. */
function sameLine(one: string, other: string): boolean {
	const plain = (text: string) =>
		text.replace(/\s+/g, " ").trim().toLowerCase();
	return plain(one) === plain(other);
}

/**
 * What a quote-and-reply reply in `text` says to `asked`, found by its line
 * rather than its number, or null when it quotes another: what follows its
 * quote, up to the next question's.
 */
export function quotedIn(text: string, asked: Asked): Answer | null {
	const lines = text.split("\n");
	const at = lines.findIndex((line) => {
		const quoted = QUOTED.exec(line);
		return quoted !== null && sameLine(quoted[1] as string, asked.text);
	});
	if (at === -1) {
		return null;
	}
	const next = lines.findIndex(
		(line, index) => index > at && QUOTED.test(line),
	);
	const rest = lines.slice(at + 1, next === -1 ? lines.length : next);
	let from = rest.findIndex((line) => line.trim() !== "");
	from = from === -1 ? rest.length : from;
	const picks: string[] = [];
	for (; from < rest.length; from += 1) {
		const key = picked(rest[from] as string, asked.choices);
		if (key === null) {
			break;
		}
		picks.push(key);
	}
	return {
		picks,
		words: rest.slice(from).map(unescaped).join("\n").trim(),
	};
}

/**
 * A hand-typed reply's line for `asked`: `2. b`, then any words. Only letters
 * it offers are picks, so `3. a quick fix` to a question without choices is
 * words.
 */
function replyLine({ number, choices }: Asked): RegExp {
	const keys = choices.map((choice) => choice.key).join("");
	const picks =
		keys === ""
			? ""
			: `(?:[ \\t]+([${keys}](?:[ \\t]*,[ \\t]*[${keys}])*)(?![a-z]))?`;
	return new RegExp(`^${number}\\.${picks}(.*)$`);
}

/**
 * What the reply in `text` says to `asked`, or null when it has nothing for
 * it: quoted, as the question cards write it, or a line typed by hand as the
 * arbor skill reads one, `2. b`, `1. a, c`, `2. b: only on phones`, or
 * `3. after a phone check`, by the number of the report it answers.
 */
export function answerIn(text: string, asked: Asked): Answer | null {
	const quoted = quotedIn(text, asked);
	if (quoted !== null) {
		return quoted;
	}
	for (const line of text.split("\n")) {
		const found = replyLine(asked).exec(line);
		if (found !== null) {
			const [picks, rest] =
				asked.choices.length === 0
					? [undefined, found[1]]
					: [found[1], found[2]];
			return {
				picks: (picks ?? "").split(/[ \t]*,[ \t]*/).filter(Boolean),
				// After picks a colon sets the words apart; without, a space.
				words: (rest ?? "").replace(picks ? /^:?[ \t]?/ : /^[ \t]/, "").trim(),
			};
		}
	}
	return null;
}

/**
 * What `text`, a reply, says besides its answers to `asked`: what comes
 * before its first quoted question, or around the lines typed by hand.
 */
export function besides(text: string, asked: Asked[]): string {
	const lines = text.split("\n");
	const quoted = lines.findIndex((line) => QUOTED.test(line));
	return (quoted === -1 ? lines : lines.slice(0, quoted))
		.filter((line) => !asked.some((each) => replyLine(each).test(line)))
		.map(unescaped)
		.join("\n")
		.trim();
}
