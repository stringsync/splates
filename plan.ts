import { Markdown } from "webappwiz/md";

/** The plan each task keeps at its worktree root, excluded from git. */
export const PLAN_FILE = "ARBOR.md";

/** The h2 sections an `ARBOR.md` may have, in the order they belong in. */
const SECTIONS = ["Goal", "Files", "Done", "Next", "Notes", "Blocked"];
const REQUIRED = ["Goal", "Files", "Next"];
const UNCHECKED = /^[ \t]*- \[ \]/m;
// A `Q` before the number is how plans were numbered once, and still reads.
const QUESTION = /^[ \t]*- \[[ xX]\] [Qq]?\d+\./m;

const BULLET = /^- +(.+)$/;

/**
 * The paths an `ARBOR.md` says its task will touch: each top-level bullet
 * under `## Files`, taken as written. Prose around the list is left out, and a
 * plan with no such section plans nothing.
 */
export function plannedFiles(text: string): string[] {
	const md = Markdown.parse(text);
	if (!md.has("Files")) {
		return [];
	}
	return md
		.section("Files")
		.body.split("\n")
		.flatMap((line) => {
			const item = BULLET.exec(line)?.[1];
			return item === undefined ? [] : [item.replaceAll("`", "").trim()];
		});
}

/**
 * One `- [ ] 9.` item under `## Blocked`: something only a person can do.
 * The item's line is its subject; lines indented under it are its body, and
 * `- (a) ...` or `- [a] ...` lines among them are the answers it offers.
 */
export interface Question {
	/** As the plan numbers it, `9`: the name a reply goes by. */
	number: string;
	/** Checked off, which the agent does once it has acted on the reply. */
	done: boolean;
	/** The item's own line, without its checkbox, number or reply. */
	text: string;
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
	 * `- [a]` choices, where it picks all that apply. Null without choices.
	 */
	pick: "one" | "any" | null;
}

/** One answer a question offers: `- (b) Migrate on next login`. */
export interface Choice {
	/** The letter it goes by: `b`. */
	key: string;
	text: string;
}

const ITEM = /^[ \t]*- \[([ xX])\] [Qq]?(\d+)\.[ \t]*(.*)$/;
/** What separates an item from its reply, spaces included. */
const ARROW = " → ";
/** A follow-up: a line of its own under the question, led by the arrow. */
const FOLLOW_UP = /^[ \t]+→[ \t]+(.*)$/;
/** `- (a) text` picks one, `- [a] text` picks any. */
const CHOICE = /^[ \t]+- (?:\(([a-z])\)|\[([a-z])\])[ \t]+(.+)$/;

/**
 * Every numbered item under `## Blocked`, open or checked off, each with the
 * indented lines under it. The reply is read off the item's own line: an
 * answer is one line after the arrow, which the agent writes in from the
 * user's reply in chat.
 */
export function questions(text: string): Question[] {
	const found: { asked: Question; body: string[] }[] = [];
	// The question the lines being read sit under, if they still do.
	let last: { asked: Question; body: string[] } | undefined;
	for (const { line } of blockedLines(text)) {
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
		const choice = CHOICE.exec(line);
		if (followUp !== null) {
			last.asked.followUps.push((followUp[1] ?? "").trim());
		} else if (choice !== null) {
			last.asked.choices.push({
				key: choice[1] ?? choice[2] ?? "",
				text: (choice[3] ?? "").trim(),
			});
			last.asked.pick ??= choice[1] === undefined ? "any" : "one";
		} else {
			last.body.push(line);
		}
	}
	return found.map(({ asked, body }) => {
		asked.body = dedent(body);
		return asked;
	});
}

/** Lines with the indent they all share taken off, blank ends trimmed. */
function dedent(lines: string[]): string {
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
 * The plan with a new open question at the end of `## Blocked`, the section
 * made if missing, numbered after the highest there. Returns the plan and
 * the number it went by.
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
	const blocked = blockedLines(text);
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
	return {
		number,
		done: check !== " ",
		text: (arrow === -1 ? rest : rest.slice(0, arrow)).trim(),
		body: "",
		reply: arrow === -1 ? null : rest.slice(arrow + ARROW.length).trim(),
		followUps: [],
		choices: [],
		pick: null,
	};
}

/**
 * The lines under `## Blocked`, with where each sits in the whole file so a
 * reply can be written back in place.
 */
function blockedLines(text: string): { index: number; line: string }[] {
	const { sections } = Markdown.parse(text);
	const at = sections.findIndex(
		(section) => section.heading.toLowerCase() === "blocked",
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
	/** Whether the task has escalated, which makes `## Blocked` required. */
	escalated?: boolean;
}

/**
 * Every way a task's `ARBOR.md` departs from the shape the agent skill
 * prescribes, phrased for the agent that wrote it. Advisory only: a resumable
 * plan is the point, and a malformed one still beats none, so nothing here
 * blocks a merge.
 */
export function checkPlan(
	text: string,
	{ task, escalated = false }: PlanOptions,
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
	if (section("Files") === "") {
		problems.push("## Files is empty: list the file paths you plan to touch");
	}
	const next = section("Next");
	if (next !== null && !UNCHECKED.test(next)) {
		problems.push("## Next has no `- [ ]` item: say what the next step is");
	}
	const done = section("Done");
	if (done !== null && UNCHECKED.test(done)) {
		problems.push("## Done has a `- [ ]` item: it belongs under ## Next");
	}
	const blocked = section("Blocked");
	if (escalated && blocked === null) {
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
