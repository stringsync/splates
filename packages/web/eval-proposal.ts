/**
 * An eval as an agent writes it in a fenced `eval` block: its optional id,
 * group and title, starting state (`repo`, `files`, `state`, or legacy
 * `starts`), a script of alternating user and agent turns (keeping the
 * one-message `you` + `pass` form working), and how it is graded.
 *
 * ```eval
 * id: splates/plan-before-edit
 * group: The splates skill
 * title: posts a plan and waits before editing
 * repo: `mono` on `main` (clean)
 * files: `README.md` has `"teh"`
 * state: Plan posted · trust 47
 * you: Fix the typo in `README.md` and merge it.
 * tool: Read README.md
 * agent: Found `"teh"` on line 3. Posted a short plan and waiting for approval.
 * you: `[SPLATES APPROVE]` Looks good, go ahead.
 * tool: Bash splates trust
 * does: Checks `splates trust` before touching files.
 * agent: Posts a Plan card instead of editing.
 * check: No file edits before approval.
 * judge: Does the agent wait for plan approval before editing?
 * ```
 */
export interface EvalProposal {
	/** Optional eval id, shown in monospace at the header's end. */
	id: string | null;
	/** The spec's `it` string, shown as the card's bold title. */
	title: string;
	/** The subject it is about, from `describe`; shown as `Eval · <group>`. */
	group: string | null;
	/** The first user message, kept for callers that expect a single turn. */
	message: string;
	/** Ordered user and agent turns of the eval script. */
	turns: EvalScriptTurn[];
	/** All agent steps across the script (kept for single-turn callers). */
	pass: EvalTurn[];
	/** Legacy `fail` lines, still read and ignored when drawing. */
	fail: EvalTurn[];
	/** Starting repo line, or null. */
	repo: string | null;
	/** Starting files line, or null. */
	files: string | null;
	/** Starting state line, or null. */
	state: string | null;
	/** Legacy one-line starting environment, or null. */
	starts: string | null;
	/** Each code check's one line. */
	checks: string[];
	/** The judge's question, or null when it has no judge. */
	judge: string | null;
	/** The model that judges, like `Jev` or `Sonnet`, or null for the default. */
	judgedBy: string | null;
}

/** One turn in an eval's conversation script. */
export type EvalScriptTurn =
	| { role: "user"; text: string }
	| { role: "agent"; steps: EvalTurn[] };

/** One step of a sketched agent turn: words it says, or a tool it calls. */
export type EvalTurn =
	| { kind: "text"; text: string }
	| { kind: "tool"; name: string; input: string; does: string | null };

const LINE =
	/^\s*(id|title|group|repo|files|state|starts|you|user|agent tool|pass tool|fail tool|tool|agent|pass|fail|does|check|judge|judged by)\s*:\s?(.*)$/i;

/** The eval `source` writes, or null when it lacks a title, a user turn or an agent step. */
export function evalProposalOf(source: string): EvalProposal | null {
	const found: EvalProposal = {
		id: null,
		title: "",
		group: null,
		message: "",
		turns: [],
		pass: [],
		fail: [],
		repo: null,
		files: null,
		state: null,
		starts: null,
		checks: [],
		judge: null,
		judgedBy: null,
	};
	let lastTool: Extract<EvalTurn, { kind: "tool" }> | null = null;

	const pushAgentStep = (step: EvalTurn) => {
		found.pass.push(step);
		const prev = found.turns.at(-1);
		if (prev?.role === "agent") {
			prev.steps.push(step);
		} else {
			found.turns.push({ role: "agent", steps: [step] });
		}
	};

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
			case "id":
				found.id = value;
				break;
			case "title":
				found.title = value;
				break;
			case "group":
				found.group = value;
				break;
			case "repo":
				found.repo = value;
				break;
			case "files":
				found.files = value;
				break;
			case "state":
				found.state = value;
				break;
			case "starts":
				found.starts = value;
				break;
			case "you":
			case "user": {
				const text = unescaped(value);
				if (found.message === "") {
					found.message = text;
				}
				found.turns.push({ role: "user", text });
				lastTool = null;
				break;
			}
			case "agent":
			case "pass":
				pushAgentStep({ kind: "text", text: unescaped(value) });
				lastTool = null;
				break;
			case "fail":
				found.fail.push({ kind: "text", text: unescaped(value) });
				lastTool = null;
				break;
			case "tool":
			case "agent tool":
			case "pass tool": {
				const [name = "", ...rest] = value.split(/\s+/);
				const tool: Extract<EvalTurn, { kind: "tool" }> = {
					kind: "tool",
					name,
					input: rest.join(" "),
					does: null,
				};
				pushAgentStep(tool);
				lastTool = tool;
				break;
			}
			case "fail tool": {
				const [name = "", ...rest] = value.split(/\s+/);
				const tool: Extract<EvalTurn, { kind: "tool" }> = {
					kind: "tool",
					name,
					input: rest.join(" "),
					does: null,
				};
				found.fail.push(tool);
				lastTool = tool;
				break;
			}
			case "does":
				if (lastTool !== null) {
					lastTool.does = value;
				}
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
