/**
 * A proposed eval as an agent writes it in a fenced `eval` block: its title,
 * what the person says, one sketched reply that passes (`fail` lines are still read but not drawn),
 * and how it is graded. Each line is `<key>: <value>`; `pass` and `fail`
 * repeat, one line a turn, and `pass tool` / `fail tool` is a tool call in
 * that reply, its first word the tool's name. A `does` line after it says in
 * plain words what the call does, which the card shows in place of the input:
 *
 * ```eval
 * group: The splates skill
 * title: skips the plan and says so for a trivial fix
 * you: README.md says 'teh' in the intro, fix it.
 * pass: Small and easy to revert: building directly.
 * pass tool: Bash splates merge --message "Fix the README typo"
 * does: Lands the README fix with `splates merge`.
 * fail: 📝 Plan: fix README typo … Do you approve?
 * starts: README.md whose intro says "teh", in one commit
 * check: Ran `splates add` before reading README.md.
 * judge: Before building, does the agent say in one line that it skips a plan?
 * judged by: Sonnet
 * ```
 */
export interface EvalProposal {
	/** The spec's `it` string, a phrase that continues the group: "skips the plan". */
	title: string;
	/** The subject it is about, from `describe`, so group and title read as one sentence; or null. */
	group: string | null;
	/** What the person says to the agent. */
	message: string;
	pass: EvalTurn[];
	fail: EvalTurn[];
	/** The repo it starts from, in a line, or null. */
	starts: string | null;
	/** Each code check's one line. */
	checks: string[];
	/** The judge's question, or null when it has no judge. */
	judge: string | null;
	/** The model that judges, like `Sonnet`, or null for the default. */
	judgedBy: string | null;
}

/** A turn of a sketched reply: words it says, or a tool it calls. */
export type EvalTurn =
	| { kind: "text"; text: string }
	| { kind: "tool"; name: string; input: string; does: string | null };

const LINE =
	/^\s*(title|group|you|pass tool|fail tool|does|pass|fail|starts|check|judge|judged by)\s*:\s?(.*)$/i;

/** The proposal `source` writes, or null when it lacks a title, a message or a reply. */
export function evalProposalOf(source: string): EvalProposal | null {
	const found: EvalProposal = {
		title: "",
		group: null,
		message: "",
		pass: [],
		fail: [],
		starts: null,
		checks: [],
		judge: null,
		judgedBy: null,
	};
	let lastTool: Extract<EvalTurn, { kind: "tool" }> | null = null;
	for (const line of source.split("\n")) {
		const match = LINE.exec(line);
		if (match === null) {
			continue;
		}
		const key = (match[1] as string).toLowerCase();
		const value = (match[2] as string).trim();
		if (value === "") {
			continue;
		}
		switch (key) {
			case "title":
				found.title = value;
				break;
			case "group":
				found.group = value;
				break;
			case "you":
				found.message = unescaped(value);
				break;
			case "pass":
			case "fail":
				found[key].push({ kind: "text", text: unescaped(value) });
				break;
			case "pass tool":
			case "fail tool": {
				const [name = "", ...rest] = value.split(/\s+/);
				const tool = {
					kind: "tool" as const,
					name,
					input: rest.join(" "),
					does: null,
				};
				found[key === "pass tool" ? "pass" : "fail"].push(tool);
				lastTool = tool;
				break;
			}
			case "does":
				if (lastTool !== null) {
					lastTool.does = value;
				}
				break;
			case "starts":
				found.starts = value;
				break;
			case "check":
				found.checks.push(value);
				break;
			case "judge":
				found.judge = value;
				break;
			case "judged by":
				found.judgedBy = value;
				break;
		}
	}
	if (found.title === "" || found.message === "" || found.pass.length === 0) {
		return null;
	}
	return found;
}

/** `value` with an agent's literal `\n` written as the line break it meant. */
function unescaped(value: string): string {
	return value.replace(/\\n/g, "\n");
}
