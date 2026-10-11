import { dedent, offers, type Question } from "./plan";

/**
 * A stretch of an agent's message: markdown as it was written, the questions
 * it asks the person in the arbor skill's format, its report asking them to
 * review a task before it merges, its report of how a task ended or what it
 * waits on, or a todo it proposes.
 */
export type Stretch =
	| { type: "text"; text: string }
	| { type: "questions"; questions: Question[] }
	| { type: "review"; review: Review }
	| { type: "report"; report: Report }
	| { type: "todo"; todo: Proposal };

/** A review the skill's `## 🔍 Ready to merge` report asks for. */
export interface Review {
	task: string;
	base: string;
	/** What changed, and what to look at and where, as markdown. */
	body: string;
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
const HEADING = /^#{1,6}[ \t]/;

/** A review report's title, and the line every one ends with. */
const REVIEW = /^## 🔍 Ready to merge (\S+) onto (\S+)[ \t]*$/;
const REVIEW_END = 'Reply "merge", or say what to change.';

/** An item of a numbered list, at the margin: `2. How should …?`. */
const ITEM = /^(\d+)\.[ \t]+(.+)$/;
const FENCE = /^[ \t]*(```|~~~)/;

/**
 * `text` cut where it asks questions: a list numbered from 1 at the margin,
 * outside code blocks, every item a question (its line ends in `?`), the
 * lines indented under each its body and its `- (a)` or `- [a]` choices,
 * read as `## Blocked` reads them. Any other list is only text.
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
					body: lines
						.slice(i + 1, end)
						.join("\n")
						.replace(/^\n+|\s+$/g, ""),
				},
			});
			from = end + 1;
			i = end;
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
	const report: Report =
		merged !== null
			? {
					ending: "merged",
					task: merged[1] as string,
					base: merged[2] as string,
					reason: null,
					body,
				}
			: {
					ending: ended?.[1] === undefined ? "escalated" : "removed",
					task: ended?.[2] as string,
					base: null,
					reason: ended?.[3] || null,
					body,
				};
	return { stretch: { type: "report", report }, end };
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
	if (!items.every(({ asked }) => asked.text.endsWith("?"))) {
		return null;
	}
	return {
		questions: items.map(({ asked, body }) => {
			asked.body = dedent(body);
			return asked;
		}),
		end,
	};
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

/** The question an answer is for: its number, and the letters it offers. */
type Asked = Pick<Question, "number" | "choices">;

/**
 * A reply's line for `asked`: `2. b`, then any words. Only letters it offers
 * are picks, so `3. a quick fix` to a question without choices is words.
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
 * What the reply in `text` says to `asked`, or null when it has no line for
 * it yet. Words keep what is typed after them, a trailing space included,
 * so a box showing them can be typed into.
 */
export function answerIn(text: string, asked: Asked): Answer | null {
	for (const line of text.split("\n")) {
		const found = replyLine(asked).exec(line);
		if (found !== null) {
			const [picks, rest] =
				asked.choices.length === 0
					? [undefined, found[1]]
					: [found[1], found[2]];
			return {
				picks: (picks ?? "").split(/[ \t]*,[ \t]*/).filter(Boolean),
				// After picks a colon sets the words apart; without, a space, and
				// a colon too where there are choices, as `withAnswer` writes
				// words that would otherwise read as picks.
				words: (rest ?? "").replace(
					picks
						? /^:?[ \t]?/
						: asked.choices.length === 0
							? /^[ \t]/
							: /^[ \t](?::[ \t]?)?/,
					"",
				),
			};
		}
	}
	return null;
}

/**
 * `text`, the reply being written, with `asked` answered by `answer`, as the
 * arbor skill reads a reply: `2. b`, `1. a, c`, `2. b: only on phones`, or
 * `3. after a phone check`. Every other line stays; a question with no line
 * yet gets one, among the others in number order, and an empty answer drops
 * its line.
 */
export function withAnswer(text: string, asked: Asked, answer: Answer): string {
	const { number } = asked;
	const lines = text === "" ? [] : text.split("\n");
	const said = [answer.picks.join(", "), answer.words].filter(Boolean);
	const plain = said.length === 0 ? null : `${number}. ${said.join(": ")}`;
	// Words alone that start like picks, `2. a lot`, would read back as pick
	// a: an empty pick before a colon keeps them words, so a box showing them
	// shows what was typed.
	const line =
		plain === null || sameAnswer(answerIn(plain, asked), answer)
			? plain
			: `${number}. : ${answer.words}`;
	const at = lines.findIndex((each) => replyLine(asked).test(each));
	if (at !== -1) {
		if (line === null) {
			lines.splice(at, 1);
		} else {
			lines[at] = line;
		}
		return lines.join("\n");
	}
	if (line === null) {
		return text;
	}
	const numbered = lines
		.map((each, index) => ({ index, number: /^(\d+)\./.exec(each)?.[1] }))
		.filter((each) => each.number !== undefined);
	const after = numbered.find((each) => Number(each.number) > Number(number));
	const index =
		after?.index ??
		(numbered.length > 0 ? (numbered.at(-1)?.index ?? 0) + 1 : lines.length);
	lines.splice(index, 0, line);
	return lines.join("\n");
}

function sameAnswer(read: Answer | null, answer: Answer): boolean {
	return (
		read !== null &&
		read.words === answer.words &&
		read.picks.join(",") === answer.picks.join(",")
	);
}
