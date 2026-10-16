import type { Question } from "./plan";

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

/** The answer that leaves `assumed` as the agent took it: its `(chosen)` choices. */
export function takenOf(assumed: Question): Answer {
	return {
		picks: assumed.choices
			.filter((choice) => choice.chosen)
			.map((choice) => choice.key),
		words: "",
	};
}

/** Whether `answer` challenges `assumed`: says anything but what it took. */
export function challenges(assumed: Question, answer: Answer): boolean {
	const taken = takenOf(assumed).picks;
	return (
		!isEmpty(answer) &&
		(answer.words.trim() !== "" ||
			answer.picks.length !== taken.length ||
			answer.picks.some((key) => !taken.includes(key)))
	);
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
