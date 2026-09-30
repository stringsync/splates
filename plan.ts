import { Markdown } from "webappwiz/md";

/** The plan each task keeps at its worktree root, excluded from git. */
export const PLAN_FILE = "ARBOR.md";

/** The h2 sections an `ARBOR.md` may have, in the order they belong in. */
const SECTIONS = ["Goal", "Files", "Done", "Next", "Notes", "Blocked"];
const REQUIRED = ["Goal", "Files", "Next"];
const UNCHECKED = /^[ \t]*- \[ \]/m;
const QUESTION = /^[ \t]*- \[[ xX]\] Q\d+\./m;
const OPEN_QUESTION = /^[ \t]*- \[ \] (Q\d+)\./gm;

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

/** One `- [ ] Q9.` item under `## Blocked`: something only a person can do. */
export interface Question {
	/** As the plan numbers it, `Q9`: the name a reply goes by. */
	number: string;
	/** Checked off, which the agent does once it has acted on the reply. */
	done: boolean;
	/** The domains it needs, `[ui, db]` after the number, for picking a slice. */
	tags: string[];
	/** The item itself, without its checkbox, number, tags or reply. */
	text: string;
	/** Whatever follows ` → `, or null when nobody has answered yet. */
	reply: string | null;
	/**
	 * The answers it offers, one `- (a) ...` line each under it, in order. Empty
	 * for a question answered in words alone. A reply can always add words to
	 * a choice, or answer in words instead of one.
	 */
	choices: Choice[];
	/** Which choice the reply picked, by key, or null. */
	chosen: string | null;
}

/** One answer a question offers: `- (b) Migrate on next login`. */
export interface Choice {
	/** The letter it goes by: `b`. */
	key: string;
	text: string;
}

const ITEM = /^[ \t]*- \[([ xX])\] (Q\d+)\.[ \t]*(.*)$/;
const TAG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const TAGS = new RegExp(`^\\[(${TAG}(?:,[ \\t]*${TAG})*)\\][ \\t]*`);
/** What separates an item from its reply, spaces included. */
const ARROW = " → ";
const CHOICE = /^[ \t]+- \(([a-z])\)[ \t]+(.+)$/;
/** A reply that picked one: `b`, `b (Migrate on next login)`, `b: and email them`. */
const PICKED = /^([a-z])(?=$|:| \()/;

/**
 * Every numbered item under `## Blocked`, open or checked off. The reply is
 * read off the item's own line: an answer is one line, written by `arbor
 * reply` or by hand after the arrow.
 */
export function questions(text: string): Question[] {
	const found: Question[] = [];
	for (const { line } of blockedLines(text)) {
		const asked = question(line);
		const last = found.at(-1);
		const choice = CHOICE.exec(line);
		if (asked !== null) {
			found.push(asked);
		} else if (choice !== null && last !== undefined) {
			// Indented under the question it offers them for.
			last.choices.push({
				key: choice[1] ?? "",
				text: (choice[2] ?? "").trim(),
			});
		}
	}
	for (const asked of found) {
		const key =
			asked.reply === null ? undefined : PICKED.exec(asked.reply)?.[1];
		asked.chosen = asked.choices.some((choice) => choice.key === key)
			? (key ?? null)
			: null;
	}
	return found;
}

/**
 * How a reply reads in the plan: the choice spelled out, so the agent needs
 * nothing but the line, then any words after it. `b (Migrate on next login):
 * and email them first`.
 */
export function replyLine(
	asked: Question,
	{ choice, text }: { choice?: string; text: string },
): string {
	const picked = asked.choices.find((found) => found.key === choice);
	const words = text.trim();
	if (picked === undefined) {
		return words;
	}
	const head = `${picked.key} (${picked.text})`;
	return words === "" ? head : `${head}: ${words}`;
}

/**
 * The plan with `reply` written onto that question's line, in place of any
 * earlier one. The checkbox is left alone: checking it off is the agent's
 * word that it has acted on the answer. Null when the plan has no such
 * question.
 */
export function withReply(
	text: string,
	number: string,
	reply: string,
): string | null {
	const lines = text.split("\n");
	const target = blockedLines(text).find(
		({ line }) => question(line)?.number === number,
	);
	if (target === undefined) {
		return null;
	}
	const { index, line } = target;
	const arrow = line.indexOf(ARROW);
	const item = (arrow === -1 ? line : line.slice(0, arrow)).trimEnd();
	// A newline would end the item: the rest would read as prose under it.
	lines[index] = `${item}${ARROW}${reply.replace(/\s*\n\s*/g, " ").trim()}`;
	return lines.join("\n");
}

/**
 * A question's number however a person typed it: `Q9`, `q9`, `9` and `Q9.`
 * all mean `Q9`. Null for anything that is not a number at all.
 */
export function questionNumber(raw: string): string | null {
	const digits = /^q?(\d+)[.:]?$/i.exec(raw.trim())?.[1];
	return digits === undefined ? null : `Q${Number(digits)}`;
}

function question(line: string): Question | null {
	const item = ITEM.exec(line);
	if (item === null) {
		return null;
	}
	const [, check = " ", number = "", rest = ""] = item;
	const tagged = TAGS.exec(rest);
	const body = tagged === null ? rest : rest.slice(tagged[0].length);
	const arrow = body.indexOf(ARROW);
	return {
		number,
		done: check !== " ",
		tags: tagged?.[1]?.split(",").map((tag) => tag.trim()) ?? [],
		text: (arrow === -1 ? body : body.slice(0, arrow)).trim(),
		reply: arrow === -1 ? null : body.slice(arrow + ARROW.length).trim(),
		choices: [],
		chosen: null,
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
			"escalated with no ## Blocked section: add `- [ ] Q1.` items for what the reviewer must do",
		);
	}
	if (blocked !== null && !QUESTION.test(blocked)) {
		problems.push(
			"## Blocked lists nothing: add `- [ ] Q1.` items for what the reviewer must do",
		);
	}
	const open = blocked === null ? [] : [...blocked.matchAll(OPEN_QUESTION)];
	if (!escalated && open.length > 0) {
		const numbers = open.map((match) => match[1]).join(", ");
		problems.push(
			`## Blocked has open ${numbers}: ask the reviewer before merging`,
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
