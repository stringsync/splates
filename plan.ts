import { Markdown } from "webappwiz/md";

/** The h2 sections an `ARBOR.md` may have, in the order they belong in. */
const SECTIONS = ["Goal", "Files", "Done", "Next", "Notes", "Blocked"];
const REQUIRED = ["Goal", "Files", "Next"];
const UNCHECKED = /^[ \t]*- \[ \]/m;
const QUESTION = /^[ \t]*- \[[ xX]\] Q\d+\./m;
const OPEN_QUESTION = /^[ \t]*- \[ \] (Q\d+)\./gm;

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
