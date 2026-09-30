import { Markdown } from "webappwiz/md";

/** The plan each task keeps at its worktree root, excluded from git. */
export const PLAN_FILE = "ARBOR.md";

/** The h2 sections an `ARBOR.md` may have, in the order they belong in. */
const SECTIONS = [
	"Goal",
	"Files",
	"Done",
	"Next",
	"Notes",
	"Blocked",
	"Messages",
];
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

/**
 * One `- [ ] Q9.` item under `## Blocked`: something only a person can do.
 * The item's line is its subject; lines indented under it are its body, and
 * `- (a) ...` or `- [a] ...` lines among them are the answers it offers.
 */
export interface Question {
	/** As the plan numbers it, `Q9`: the name a reply goes by. */
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
	/** The keys of the choices the reply picked, in the order offered. */
	chosen: string[];
	/** The absolute paths of the images its text and body show. */
	images: string[];
}

/** One answer a question offers: `- (b) Migrate on next login`. */
export interface Choice {
	/** The letter it goes by: `b`. */
	key: string;
	text: string;
}

const ITEM = /^[ \t]*- \[([ xX])\] (Q\d+)\.[ \t]*(.*)$/;
/** What separates an item from its reply, spaces included. */
const ARROW = " → ";
/** `- (a) text` picks one, `- [a] text` picks any. */
const CHOICE = /^[ \t]+- (?:\(([a-z])\)|\[([a-z])\])[ \t]+(.+)$/;
/** An image the page can show: an absolute path, nothing fetched from afar. */
const IMAGE = /!\[[^\]]*\]\((\/[^)\s]+)\)/g;

/**
 * Every numbered item under `## Blocked`, open or checked off, each with the
 * indented lines under it. The reply is read off the item's own line: an
 * answer is one line, written by `arbor messages` or by hand after the arrow.
 */
export function questions(text: string): Question[] {
	const found: { asked: Question; body: string[] }[] = [];
	// The question the lines being read sit under, if they still do.
	let last: { asked: Question; body: string[] } | undefined;
	for (const { line } of sectionLines(text, "Blocked")) {
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
		const choice = CHOICE.exec(line);
		if (choice !== null) {
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
		asked.chosen = picks(asked.reply, asked.choices);
		asked.images = [
			...new Set(
				[...`${asked.text}\n${asked.body}`.matchAll(IMAGE)].flatMap((image) =>
					image[1] === undefined ? [] : [image[1]],
				),
			),
		];
		return asked;
	});
}

/**
 * How a reply reads in the plan: each pick spelled out, so the agent needs
 * nothing but the line, then any words after it. `a (Email), c (Push): and
 * log it`.
 */
export function replyLine(
	asked: Question,
	{ choices = [], text }: { choices?: string[]; text: string },
): string {
	const head = asked.choices
		.filter((choice) => choices.includes(choice.key))
		.map((choice) => `${choice.key} (${choice.text})`)
		.join(", ");
	const words = text.trim();
	if (head === "") {
		return words;
	}
	return words === "" ? head : `${head}: ${words}`;
}

/**
 * The keys a reply picked: a run of `b` or `b (Its text)`, comma separated,
 * at its start, ended by a colon or the end of the reply. Words that merely
 * start with a letter pick nothing.
 */
function picks(reply: string | null, choices: Choice[]): string[] {
	if (reply === null || choices.length === 0) {
		return [];
	}
	const picked: string[] = [];
	let rest = reply.trim();
	while (true) {
		const choice = choices.find(
			(offered) =>
				rest.startsWith(`${offered.key} (${offered.text})`) ||
				(/^[a-z](?=$|,|:)/.test(rest) && rest[0] === offered.key),
		);
		if (choice === undefined) {
			return [];
		}
		picked.push(choice.key);
		const spelled = `${choice.key} (${choice.text})`;
		rest = rest.slice(rest.startsWith(spelled) ? spelled.length : 1);
		if (rest === "" || rest.startsWith(":")) {
			return choices
				.map((offered) => offered.key)
				.filter((key) => picked.includes(key));
		}
		if (!rest.startsWith(",")) {
			return [];
		}
		rest = rest.replace(/^,\s*/, "");
	}
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
 * The plan with `reply` written onto that question's line, in place of any
 * earlier one, or with no reply there at all when it is null. The checkbox is left alone: checking it off is the agent's
 * word that it has acted on the answer. Null when the plan has no such
 * question.
 */
export function withReply(
	text: string,
	number: string,
	/** Null takes the reply off, leaving the question as it was asked. */
	reply: string | null,
): string | null {
	const lines = text.split("\n");
	const target = sectionLines(text, "Blocked").find(
		({ line }) => question(line)?.number === number,
	);
	if (target === undefined) {
		return null;
	}
	const { index, line } = target;
	const arrow = line.indexOf(ARROW);
	const item = (arrow === -1 ? line : line.slice(0, arrow)).trimEnd();
	// A newline would end the item: the rest would read as prose under it.
	lines[index] =
		reply === null
			? item
			: `${item}${ARROW}${reply.replace(/\s*\n\s*/g, " ").trim()}`;
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
	const arrow = rest.indexOf(ARROW);
	return {
		number,
		done: check !== " ",
		text: (arrow === -1 ? rest : rest.slice(0, arrow)).trim(),
		body: "",
		reply: arrow === -1 ? null : rest.slice(arrow + ARROW.length).trim(),
		choices: [],
		pick: null,
		chosen: [],
		images: [],
	};
}

/**
 * The lines under one `## <heading>`, with where each sits in the whole file
 * so a reply can be written back in place. `end` is the index just past them:
 * where an item added to the section goes.
 */
function sectionLines(
	text: string,
	heading: string,
): { index: number; line: string }[] {
	return sectionRange(text, heading)?.lines ?? [];
}

function sectionRange(
	text: string,
	heading: string,
): { lines: { index: number; line: string }[]; end: number } | null {
	const { sections } = Markdown.parse(text);
	const at = sections.findIndex(
		(section) => section.heading.toLowerCase() === heading.toLowerCase(),
	);
	const found = sections[at];
	if (found === undefined) {
		return null;
	}
	const lines = text.split("\n");
	// `line` is 1-based, so it is also the index of the line after the heading.
	const end =
		(sections.slice(at + 1).find((later) => later.level <= found.level)?.line ??
			lines.length + 1) - 1;
	return {
		lines: lines
			.slice(found.line, end)
			.map((line, offset) => ({ index: found.line + offset, line })),
		end,
	};
}

/**
 * One `- [ ] M2.` item under `## Messages`: something a person told the task's
 * agent, written there when the agent claimed it. The agent checks it off
 * once it has acted on it, as with a question.
 */
export interface PlanMessage {
	/** `M2`. */
	id: string;
	done: boolean;
	/** The item's line, and the lines indented under it, dedented. */
	text: string;
}

const MESSAGE = /^[ \t]*- \[([ xX])\] (M\d+)\.[ \t]*(.*)$/;

/** Every item under `## Messages`, open or checked off. */
export function messages(text: string): PlanMessage[] {
	const found: { message: PlanMessage; body: string[] }[] = [];
	let last: { message: PlanMessage; body: string[] } | undefined;
	for (const { line } of sectionLines(text, "Messages")) {
		const item = MESSAGE.exec(line);
		if (item !== null) {
			last = {
				message: { id: item[2] ?? "", done: item[1] !== " ", text: "" },
				body: [(item[3] ?? "").trim()],
			};
			found.push(last);
		} else if (line.trim() !== "" && !/^[ \t]/.test(line)) {
			last = undefined;
		} else {
			last?.body.push(line);
		}
	}
	return found.map(({ message, body }) => {
		const [head = "", ...rest] = body;
		message.text = [head, dedent(rest)].filter(Boolean).join("\n");
		return message;
	});
}

/**
 * The plan with a message added as the last item under `## Messages`, the
 * section made at the end of the plan if it has none. Lines after the first
 * are indented under it, so the item holds the whole message.
 */
export function withMessage(text: string, id: string, message: string): string {
	const [head = "", ...rest] = message.trim().split("\n");
	const item = [
		`- [ ] ${id}. ${head.trim()}`,
		...rest.map((line) => (line.trim() === "" ? "" : `  ${line}`)),
	];
	const range = sectionRange(text, "Messages");
	if (range === null) {
		return `${text.replace(/\s*$/, "")}\n\n## Messages\n\n${item.join("\n")}\n`;
	}
	const lines = text.split("\n");
	// After the last line with anything on it, so blank lines stay below.
	const last = range.lines.findLast(({ line }) => line.trim() !== "");
	const at = last === undefined ? range.end : last.index + 1;
	const before = last === undefined ? [""] : [];
	lines.splice(at, 0, ...before, ...item);
	return lines.join("\n");
}

/** The next free message id, after every one the plan or `taken` has. */
export function nextMessageId(text: string, taken: string[]): string {
	const numbers = [...messages(text).map((found) => found.id), ...taken]
		.filter((id) => /^M\d+$/.test(id))
		.map((id) => Number(id.slice(1)));
	return `M${Math.max(0, ...numbers) + 1}`;
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
