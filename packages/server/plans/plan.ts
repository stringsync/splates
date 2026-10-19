import { Markdown } from "webappwiz/md";
import type { Fs } from "webappwiz/system";
import { LEGACY_PLAN_FILE } from "../config/browser";

/** The plan each task keeps at its worktree root, excluded from git. */
export const PLAN_FILE = "SPLATES.md";

/** Where tasks keep their plans: each worktree's `SPLATES.md`, read through `fs`. */
export class Plans {
	constructor(private readonly fs: Fs) {}

	/**
	 * The plan in worktree `tree`, or null for none: an agent still on arbor's
	 * skill keeps it as `ARBOR.md`, read when there is no `SPLATES.md`.
	 */
	read(tree: string): Promise<string | null> {
		return this.fs
			.read(`${tree}/${PLAN_FILE}`)
			.catch(() => this.fs.read(`${tree}/${LEGACY_PLAN_FILE}`))
			.catch(() => null);
	}

	/**
	 * Keeps plans out of git in every worktree of the repository whose shared
	 * `.git` is `gitDir`, leaving the repo's own .gitignore alone.
	 */
	async exclude(gitDir: string): Promise<void> {
		// A plan is scratch for one task and must never land on trunk; the
		// .gitignore is the repo's, which splates would have to commit to.
		const info = `${gitDir}/info`;
		const excluded = await this.fs.read(`${info}/exclude`).catch(() => "");
		if (!excluded.split("\n").includes(PLAN_FILE)) {
			await this.fs.mkdir(info);
			await this.fs.write(
				`${info}/exclude`,
				`${excluded.trimEnd()}\n${PLAN_FILE}\n`.trimStart(),
			);
		}
	}
}

/**
 * The one step under `## Next` a fresh task's `SPLATES.md` starts with, asking
 * its agent to plan, which no one should read as the work under way. Its Goal
 * is already written, from `--goal` or the queued task it took.
 */
export const STUB_STEP = "list the steps here as `- [ ]` items";

/** The stub step plans written before the Goal was required still hold. */
export const OLD_STUB_STEP =
	"fill in Goal and list the steps here as `- [ ]` items";

/** The h2 sections an `SPLATES.md` may have, in the order they belong in. */
const SECTIONS = ["Goal", "Next", "Notes", "Blocked"];
const REQUIRED = ["Goal", "Next"];
// A `Q` before the number is how plans were numbered once, and still reads.
const QUESTION = /^[ \t]*- \[[ xX]\] [Qq]?\d+\./m;

/**
 * What an `SPLATES.md` says its task is for: the first line under `## Goal`, or
 * null when it says nothing yet. One line, since it sits beside other tasks'
 * in `splates list --files`.
 */
export function goalLine(text: string): string | null {
	const md = Markdown.parse(text);
	if (!md.has("Goal")) {
		return null;
	}
	const line = md
		.section("Goal")
		.body.split("\n")
		.find((line) => line.trim() !== "");
	return line === undefined ? null : line.trim();
}

/**
 * What an `SPLATES.md` says done means: all of `## Goal`, as markdown, or ""
 * when it says nothing yet.
 */
export function goalOf(text: string): string {
	const md = Markdown.parse(text);
	return md.has("Goal") ? md.section("Goal").body.trim() : "";
}

/**
 * One `- [ ] 9.` item under `## Blocked`: something only a person can do.
 * The item's line is its subject; lines indented under it are its body, and
 * `- (a) ...`, `- [a] ...` or `- a. ...` lines among them are the answers it
 * offers.
 */
export interface Question {
	/** As the plan numbers it, `9`: the name a reply goes by. */
	number: string;
	/** Checked off, which the agent does once it has acted on the reply. */
	done: boolean;
	/** The item's own line, without its checkbox, number, size or reply. */
	text: string;
	/**
	 * The `(large)` that led its line in plans from when the skill sized
	 * questions, which outcomes still keep; null when it has none.
	 */
	size: string | null;
	/**
	 * The markdown indented under it, dedented, choices left out: detail,
	 * code blocks, `![shot](/abs/path.png)` images. Empty when there is none.
	 */
	body: string;
	/** Whatever follows ` → `, or null when nobody has answered yet. */
	reply: string | null;
	/**
	 * What a person added once the reply was read, oldest first: each an
	 * indented `→ ` line under the question.
	 */
	followUps: string[];
	/**
	 * The answers it offers, in order. Empty for a question answered in words
	 * alone. A reply can always add words to its picks, or answer in words
	 * instead.
	 */
	choices: Choice[];
	/**
	 * `one` for `- (a)` choices, at most one of which a reply picks; `any` for
	 * `- [a]` choices, where it picks all that apply; `order` for `- a.`
	 * choices, which a reply puts in order, every one of them, as `b, a, c`.
	 * Null without choices.
	 */
	pick: "one" | "any" | "order" | null;
}

/** One answer a question offers: `- (b) Migrate on next login`. */
export interface Choice {
	/** The letter it goes by: `b`. */
	key: string;
	/** What it says, without the `(chosen)` that may end it. */
	text: string;
	/**
	 * The markdown indented under it, dedented: most often the screenshot of
	 * what it would look like. Empty when there is none.
	 */
	body: string;
	/**
	 * Why the agent would go with it, or not: a `Why:` line under it, without
	 * the label, kept out of `body`. The page folds
	 * it away until asked. Empty when there is none.
	 */
	why: string;
	/**
	 * Marked `(chosen)`: what the agent went with while it waits for the reply,
	 * which picks nothing for the person.
	 */
	chosen: boolean;
}

const ITEM = /^[ \t]*- \[([ xX])\] [Qq]?(\d+)\.[ \t]*(.*)$/;
/** What separates an item from its reply, spaces included. */
const ARROW = " → ";
/** A follow-up: a line of its own under the question, led by the arrow. */
const FOLLOW_UP = /^[ \t]+→[ \t]+(.*)$/;
/** `- (a) text` picks one, `- [a] text` picks any, `- a. text` is put in order. */
const CHOICE =
	/^([ \t]+)- (?:\(([a-z])\)|\[([a-z])\]|([a-z])\.)[ \t]+(.+?)[ \t]*$/;
/** What ends the choice the agent went with. */
const CHOSEN = /[ \t]*\(chosen\)$/i;

/**
 * The `(large)` that leads an item's line in a plan from when the skill sized
 * questions: any one lowercase word, read off so the question reads the same.
 */
const SIZE = /^\(([a-z]+)\)[ \t]+/;

/** `text` without the size that leads it, and that size, or null. */
export function sized(text: string): { text: string; size: string | null } {
	const size = SIZE.exec(text);
	return size === null
		? { text, size: null }
		: { text: text.slice(size[0].length), size: size[1] as string };
}

/**
 * Every numbered item under `## Blocked`, open or checked off, each with the
 * indented lines under it. The reply is read off the item's own line: an
 * answer is one line after the arrow, which the agent writes in from the
 * user's reply in chat.
 */
export function questions(text: string): Question[] {
	return items(sectionLines(text, "Blocked"));
}

/** The numbered items among `lines`, each with the indented lines under it. */
function items(lines: { line: string }[]): Question[] {
	const found: { asked: Question; body: string[] }[] = [];
	// The question the lines being read sit under, if they still do.
	let last: { asked: Question; body: string[] } | undefined;
	for (const { line } of lines) {
		const asked = question(line);
		if (asked !== null) {
			last = { asked, body: [] };
			found.push(last);
			continue;
		}
		// A line back at the margin ends the question; blank ones do not.
		if (line.trim() !== "" && !/^[ \t]/.test(line)) {
			last = undefined;
		}
		if (last === undefined) {
			continue;
		}
		const followUp = FOLLOW_UP.exec(line);
		if (followUp !== null) {
			last.asked.followUps.push((followUp[1] ?? "").trim());
		} else if (!offers(last.asked, line)) {
			last.body.push(line);
		}
	}
	return found.map(({ asked, body }) => settled(asked, body));
}

/** How far each choice's dash is indented, which what is under it goes past. */
const INDENTS = new WeakMap<Choice, number>();

/**
 * Adds what `line` offers to `asked`, saying whether it did: an indented
 * `- (a) text` picks one, `- [a] text` picks any, and `- a. text` is put in
 * order, and a line indented past a choice's dash, such as its screenshot,
 * belongs to that choice. The first choice says which for the question. The
 * same in a plan and in a conversation, which `asked.ts` reads with this.
 */
export function offers(
	asked: Pick<Question, "choices" | "pick">,
	line: string,
): boolean {
	const choice = CHOICE.exec(line);
	if (choice === null) {
		const last = asked.choices.at(-1);
		const indent = /^[ \t]*/.exec(line)?.[0].length ?? 0;
		if (
			last === undefined ||
			line.trim() === "" ||
			indent <= (INDENTS.get(last) ?? indent)
		) {
			return false;
		}
		last.body = last.body === "" ? line : `${last.body}\n${line}`;
		return true;
	}
	const [, indent = "", one, any, order, text = ""] = choice;
	const offered: Choice = {
		key: one ?? any ?? order ?? "",
		text: text.replace(CHOSEN, ""),
		body: "",
		why: "",
		chosen: CHOSEN.test(text),
	};
	INDENTS.set(offered, indent.length);
	asked.choices.push(offered);
	asked.pick ??=
		one !== undefined ? "one" : any !== undefined ? "any" : "order";
	return true;
}

/** `asked` with `body` as its own, and each choice's dedented. */
export function settled(asked: Question, body: string[]): Question {
	asked.body = dedent(body);
	for (const choice of asked.choices) {
		Object.assign(choice, reasoned(dedent(choice.body.split("\n"))));
	}
	return asked;
}

/** A choice's rationale, on a line of its own: `Why: no one is signed out`. */
const WHY = /^why:[ \t]*(.*)$/i;

/**
 * A choice's dedented `body` with its first `Why:` line taken out as `why`,
 * so a screenshot before or after it stays the body.
 */
function reasoned(body: string): Pick<Choice, "body" | "why"> {
	const lines = body.split("\n");
	const at = lines.findIndex((line) => WHY.test(line));
	if (at === -1) {
		return { body, why: "" };
	}
	return {
		body: dedent(lines.filter((_, index) => index !== at)),
		why: (WHY.exec(lines[at] ?? "")?.[1] ?? "").trim(),
	};
}

/** Lines with the indent they all share taken off, blank ends trimmed. */
export function dedent(lines: string[]): string {
	const indents = lines
		.filter((line) => line.trim() !== "")
		.map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0);
	const cut = indents.length === 0 ? 0 : Math.min(...indents);
	return lines
		.map((line) => line.slice(cut).trimEnd())
		.join("\n")
		.replace(/^\n+|\s+$/g, "");
}

/**
 * How the person met the agent's picks under `## Blocked`: the questions
 * asked, those that offered a `(chosen)` choice and were answered with a
 * choice, and of those, the ones answered with another, and the ones answered
 * with the agent's choice but with words added, in the reply or a follow-up.
 * A moot question, or one answered in words alone, is asked but picks nothing.
 */
export function picks(text: string): {
	asked: number;
	picked: number;
	overturned: number;
	amended: number;
} {
	const asked = questions(text);
	const met = asked.map(metPick).filter((each) => each !== null);
	return {
		asked: asked.length,
		picked: met.length,
		overturned: met.filter((each) => each === "overturned").length,
		amended: met.filter((each) => each === "amended").length,
	};
}

/**
 * How the person met the agent's pick on `asked`: null when it offered none,
 * picks any or an order, or was answered in words alone or not at all.
 */
function metPick(asked: Question): "kept" | "amended" | "overturned" | null {
	const chosen = asked.choices.find((choice) => choice.chosen);
	// `(b) ...`, `- (b) ...`, or a lone `b` or `b.`, as replies are written
	// back; never the `a` that starts "a lot".
	const reply = asked.reply ?? "";
	const [lead, wrapped, bare] =
		/^(?:- )?(?:\(([a-z])\)|([a-z])(?=[.,]|$))/i.exec(reply) ?? [];
	const key = wrapped ?? bare;
	if (chosen === undefined || key === undefined || asked.pick !== "one") {
		return null;
	}
	if (key.toLowerCase() !== chosen.key) {
		return "overturned";
	}
	return /[a-z0-9]/i.test(reply.slice(lead?.length ?? 0)) ||
		asked.followUps.length > 0
		? "amended"
		: "kept";
}

/**
 * One call a plan made, as an outcome keeps it: enough to count how the
 * agent's recommendations fare by size, and to size it again by its line if
 * the scheme changes.
 */
export interface Decision {
	/** As the plan numbers it. */
	number: string;
	/** The item's line, without its size. */
	text: string;
	/** The word its line was sized with, or null for none. */
	size: string | null;
	/**
	 * What became of the agent's recommendation: a pick taken as it was,
	 * kept; taken with words added, amended; answered with another choice,
	 * overturned. Null for a question with no pick to meet, or one never
	 * answered with a choice.
	 */
	ended: "kept" | "amended" | "overturned" | null;
}

/** Every question in the plan `text`, in the order numbered. */
export function decisions(text: string): Decision[] {
	return questions(text).map((item) => ({
		number: item.number,
		text: item.text,
		size: item.size,
		ended: metPick(item),
	}));
}

/** What still stands between a task and trunk, as its plan tells it. */
export interface Unfinished {
	/** Each unchecked question under `## Blocked`, by number: `["2", "4"]`. */
	questions: string[];
	/** Each unchecked step under `## Next`, as written. */
	steps: string[];
}

const STEP = /^[ \t]*- \[ \][ \t]*(.*)$/;

/**
 * The questions and steps a plan leaves unchecked. Nothing in either means the
 * task is ready to merge: `splates merge` lands it, and `splates escalate --review`
 * asks a person to look first. A task with no plan has nothing left.
 */
export function unfinished(text: string): Unfinished {
	const md = Markdown.parse(text);
	const next = md.has("Next") ? md.section("Next").body.split("\n") : [];
	return {
		questions: questions(text)
			.filter((asked) => !asked.done)
			.map((asked) => asked.number),
		steps: next.flatMap((line) => {
			const step = STEP.exec(line)?.[1];
			return step === undefined ? [] : [step.trim()];
		}),
	};
}

/** Whether {@link unfinished} found nothing left. */
export function ready({ questions, steps }: Unfinished): boolean {
	return questions.length === 0 && steps.length === 0;
}

/** What {@link unfinished} found, as a clause: `questions 1, 2 unchecked under ## Blocked`. */
export function whatIsLeft({ questions, steps }: Unfinished): string {
	return [
		questions.length > 0
			? `questions ${questions.join(", ")} unchecked under ## Blocked`
			: "",
		steps.length > 0
			? `${steps.length} step${steps.length === 1 ? "" : "s"} unchecked under ## Next`
			: "",
	]
		.filter(Boolean)
		.join(" and ");
}

/**
 * The plan with a new open question at the end of `## Blocked`, the section
 * made if missing, numbered after the highest there. Returns the plan and the
 * number it went by.
 */
export function withQuestion(
	text: string,
	subject: string,
	body = "",
): { plan: string; number: string } {
	const numbers = questions(text).map((asked) => Number(asked.number));
	const number = String(Math.max(0, ...numbers) + 1);
	const detail = body.trim() === "" ? [] : body.trim().split("\n");
	const item = [
		`- [ ] ${number}. ${subject.trim()}`,
		...detail.map((line) => `  ${line}`.trimEnd()),
	];
	const blocked = sectionLines(text, "Blocked");
	if (blocked.length === 0 && !/^## Blocked[ \t]*$/im.test(text)) {
		return {
			plan: `${text.trimEnd()}\n\n## Blocked\n\n${item.join("\n")}\n`,
			number,
		};
	}
	const lines = text.split("\n");
	const last = blocked.findLast(({ line }) => line.trim() !== "");
	const heading = lines.findIndex((line) => /^## Blocked[ \t]*$/i.test(line));
	const at = last === undefined ? heading + 1 : last.index + 1;
	lines.splice(at, 0, ...(last === undefined ? ["", ...item] : item));
	return { plan: lines.join("\n"), number };
}

/**
 * A question's number however a person typed it: `9`, `9.`, `Q9` and `q9:`
 * all mean `9`. Null for anything that is not a number at all.
 */
export function questionNumber(raw: string): string | null {
	const digits = /^q?(\d+)[.:]?$/i.exec(raw.trim())?.[1];
	return digits === undefined ? null : String(Number(digits));
}

function question(line: string): Question | null {
	const item = ITEM.exec(line);
	if (item === null) {
		return null;
	}
	const [, check = " ", number = "", rest = ""] = item;
	const arrow = rest.indexOf(ARROW);
	const { text, size } = sized(
		(arrow === -1 ? rest : rest.slice(0, arrow)).trim(),
	);
	return {
		number,
		done: check !== " ",
		text,
		size,
		body: "",
		reply: arrow === -1 ? null : rest.slice(arrow + ARROW.length).trim(),
		followUps: [],
		choices: [],
		pick: null,
	};
}

/**
 * The lines under the section headed `name`, with where each sits in the
 * whole file so a reply can be written back in place.
 */
function sectionLines(
	text: string,
	name: string,
): { index: number; line: string }[] {
	const { sections } = Markdown.parse(text);
	const at = sections.findIndex(
		(section) => section.heading.toLowerCase() === name.toLowerCase(),
	);
	const blocked = sections[at];
	if (blocked === undefined) {
		return [];
	}
	const lines = text.split("\n");
	// `line` is 1-based, so it is also the index of the line after the heading.
	const end =
		sections.slice(at + 1).find((later) => later.level <= blocked.level)
			?.line ?? lines.length + 1;
	return lines
		.slice(blocked.line, end - 1)
		.map((line, offset) => ({ index: blocked.line + offset, line }));
}

export interface PlanOptions {
	/** The task name the title is expected to match. */
	task: string;
	/**
	 * Whether the task has escalated, which makes `## Blocked` required unless
	 * it escalated for a review.
	 */
	escalated?: boolean;
	/** Whether the escalation asks only to approve merging. */
	review?: boolean;
}

/**
 * Every way a task's `SPLATES.md` departs from the shape the agent skill
 * prescribes, phrased for the agent that wrote it. Advisory only: a resumable
 * plan is the point, and a malformed one still beats none, so nothing here
 * blocks a merge.
 */
export function checkPlan(
	text: string,
	{ task, escalated = false, review = false }: PlanOptions,
): string[] {
	const md = Markdown.parse(text);
	const problems: string[] = [];
	const section = (name: string) =>
		md.has(name) ? md.section(name).body : null;

	if (md.title !== task) {
		problems.push(
			md.title === null
				? `no title: the first line should be "# ${task}"`
				: `title is "# ${md.title}", should be "# ${task}"`,
		);
	}
	for (const name of REQUIRED) {
		if (!md.has(name)) {
			problems.push(`no ## ${name} section`);
		}
	}
	if (section("Goal") === "") {
		problems.push("## Goal is empty: say in a line or two what done means");
	}
	const blocked = section("Blocked");
	// A review asks only to approve merging, which needs no question.
	if (escalated && !review && blocked === null) {
		problems.push(
			"escalated with no ## Blocked section: add `- [ ] 1.` items for what the reviewer must do",
		);
	}
	if (blocked !== null && !QUESTION.test(blocked)) {
		problems.push(
			"## Blocked lists nothing: add `- [ ] 1.` items for what the reviewer must do",
		);
	}
	// Answered and unchecked is a follow-up to act on; unanswered needs a person.
	const open = questions(text).filter(
		(asked) => !asked.done && asked.reply === null,
	);
	if (!escalated && open.length > 0) {
		const numbers = open.map((asked) => asked.number).join(", ");
		problems.push(
			`## Blocked has open questions ${numbers}: ask the reviewer before merging`,
		);
	}
	const numbers = questions(text).map((item) => item.number);
	const twice = [
		...new Set(numbers.filter((each, at) => numbers.indexOf(each) !== at)),
	];
	if (twice.length > 0) {
		problems.push(
			`${twice.join(", ")} numbered twice under ## Blocked: new questions continue from the highest`,
		);
	}
	const known = SECTIONS.map((section) => section.toLowerCase());
	for (const section of md.sections) {
		if (section.level === 2 && !known.includes(section.heading.toLowerCase())) {
			problems.push(
				`unexpected section "## ${section.heading}" (line ${section.line}): keep to ${SECTIONS.join(", ")}`,
			);
		}
	}
	return problems;
}
