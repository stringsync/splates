import { Markdown } from "@webappwiz/md";

/** The h2 sections a `TODO.md` may have, in the order they belong in. */
const SECTIONS = ["Goal", "Done", "Next", "Notes", "Blocked"];
const REQUIRED = ["Goal", "Next"];
const UNCHECKED = /^[ \t]*- \[ \]/m;

/**
 * Every way a task's `TODO.md` departs from the shape the agent skill
 * prescribes, phrased for the agent that wrote it. Advisory only: a resumable
 * TODO is the point, and a malformed one still beats none, so nothing here
 * blocks a merge.
 */
export function checkTodo(
	text: string,
	{ task, escalated = false }: { task: string; escalated?: boolean },
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
			"escalated with no ## Blocked section: state what needs verifying and the question a human must answer",
		);
	}
	if (blocked !== null && !blocked.includes("?")) {
		problems.push(
			"## Blocked asks nothing: a human needs one specific question to answer",
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
