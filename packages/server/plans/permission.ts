import type { Reach } from "../projects";

/** Whether `line` titles a permission card. */
export function asksPermission(line: string): boolean {
	return [PERMISSION, GRANT_PERMISSION, EVALS_PERMISSION, RUN_PERMISSION].some(
		(each) => each.test(line),
	);
}

/** What the permission card titled `line`, with `body` under it, asks; null for any other line. */
export function permissionOf(
	line: string,
	body: string,
): PermissionProposal | null {
	const permission = PERMISSION.exec(line);
	const evals = EVALS_PERMISSION.exec(line);
	const run = RUN_PERMISSION.exec(line);
	const grant = GRANT_PERMISSION.exec(line);
	if (run !== null) {
		const rows = body.split("\n");
		const at = rows.findIndex((each) => RUN_COMMAND.test(each));
		const command =
			at < 0 ? "" : (RUN_COMMAND.exec(rows[at] as string)?.[1] as string);
		return {
			action: "run-command",
			lane: null,
			tasks: [],
			title: run[1] || null,
			body: rows
				.filter((_, index) => index !== at)
				.join("\n")
				.replace(/^\n+|\s+$/g, ""),
			command,
		};
	}
	if (grant !== null) {
		return {
			action: "grant",
			lane: null,
			tasks: [],
			title: grant[4] || null,
			body: body.replace(COMMAND_LINE, "").replace(/^\n+|\s+$/g, ""),
			grant: {
				in: grant[1] as string,
				reach: grant[2] as Reach,
				from: grant[3] as string,
			},
		};
	}
	if (evals !== null) {
		const scenarios: string[] = [];
		let baseline: string | null = null;
		let reps: number | undefined;
		const prose = body.split("\n").filter((each) => {
			const scenario = EVAL_PROBE.exec(each);
			if (scenario !== null) {
				scenarios.push(scenario[1] as string);
				return false;
			}
			const base = EVAL_BASELINE.exec(each);
			if (base !== null) {
				baseline = base[1] as string;
				return false;
			}
			const times = EVAL_REPS.exec(each);
			if (times !== null && Number(times[1]) > 0) {
				reps = Number(times[1]);
				return false;
			}
			return true;
		});
		return {
			action: "run-evals",
			lane: null,
			tasks: [],
			title: evals[2] || null,
			body: prose.join("\n").replace(/^\n+|\s+$/g, ""),
			evals: {
				skill: evals[1] as string,
				scenarios,
				baseline,
				...(reps === undefined ? {} : { reps }),
			},
		};
	}
	if (permission !== null) {
		const lane = permission[2] ?? permission[3] ?? permission[6];
		return {
			action: permission[1] === undefined ? "queue" : "remove-lane",
			lane: lane === undefined ? null : Number(lane),
			tasks: Array.from(
				(permission[5] ?? permission[7] ?? "").matchAll(/\d+/g),
				Number,
			),
			...(permission[4] === undefined ? {} : { project: permission[4] }),
			title: permission[8] || null,
			body: body.replace(COMMAND_LINE, "").replace(/^\n+|\s+$/g, ""),
		};
	}
	return null;
}

/**
 * What the agent asks the person to allow, as the skill's `## 🔐 Permission:
 * queue lane <n>: <name>`, `## 🔐 Permission: queue #<n>, #<n>: <what>`
 * (`queue <project> #<n>` for another project's tasks), `## 🔐 Permission:
 * grant <project> <reach> to <project>` or `## 🔐 Permission: remove lane <n>:
 * <name>` puts it: an agent never does these itself, so the card's buttons
 * are the person's. The older `## 📥 Queue ...` titles read as the queue ones.
 */
export interface PermissionProposal {
	/**
	 * What it asks: queue work, remove a lane with its tasks, run evals, run
	 * a heavy command, the whole test suite among them, or let one project
	 * reach further into another.
	 */
	action: "queue" | "remove-lane" | "run-evals" | "run-command" | "grant";
	/**
	 * For `queue`: the other project, by its slug, whose tasks it queues;
	 * absent for the conversation's own.
	 */
	project?: string;
	/** For `grant`: what it lets project `from` do in project `in`. */
	grant?: ReachAsk;
	/** The lane it acts on whole; null for tasks named one by one. */
	lane: number | null;
	/** The tasks named one by one; none for a lane. */
	tasks: number[];
	/** What the title says after its colon, if anything. */
	title: string | null;
	/** What it comes to, as markdown. */
	body: string;
	/** For `run-evals`: what to run, from the card's scenario list. */
	evals?: EvalAsk;
	/** For `run-command`: the command to run, from the first backticked line. */
	command?: string;
}

/**
 * The reach a `## 🔐 Permission: grant <in> <reach> to <from>` card asks
 * project `in` to give project `from`, each by its slug.
 */
export interface ReachAsk {
	in: string;
	from: string;
	reach: Reach;
}

/**
 * The evals a `## 🔐 Permission: run evals <skill>: <what it checks>` card
 * asks to run: the scenarios it picked, one `` - `scenario-id` `` item each, and
 * optionally the revision the skill's change is judged against, as a
 * `` Baseline: `rev` `` line and how many times to run each cell, as a
 * `Repetitions: <n>` line.
 */
export interface EvalAsk {
	skill: string;
	scenarios: string[];
	baseline: string | null;
	/** Runs of each cell; the runner's own default when absent. */
	reps?: number;
}

const EVALS_PERMISSION =
	/^## 🔐 Permission: run evals (\S+?)(?::[ \t]*(.*?))?[ \t]*$/;
/** A run-evals card's scenario: a list item that is one code span, then maybe a note. */
const EVAL_PROBE = /^[-*][ \t]+`([^`\s]+)`(?:[ \t].*)?$/;
const EVAL_BASELINE = /^Baseline:[ \t]*`([^`\s]+)`[ \t]*$/;
const EVAL_REPS = /^Repetitions:[ \t]*(\d+)[ \t]*$/;
const RUN_PERMISSION = /^## 🔐 Permission: run command(?::[ \t]*(.*?))?[ \t]*$/;
/** A run-command card's command: a line that is one code span. */
const RUN_COMMAND = /^`([^`\n]+)`[ \t]*$/;
const PERMISSION =
	/^## (?:🔐 Permission: (?:(remove) lane (\d+)|queue (?:lane (\d+)|(?:([\w.-]+) )?(#\d+(?:,[ \t]*#\d+)*)))|📥 Queue (?:lane (\d+)|(#\d+(?:,[ \t]*#\d+)*)))(?::[ \t]*(.*?))?[ \t]*$/;
const GRANT_PERMISSION =
	/^## 🔐 Permission: grant ([\w.-]+) (read|queue|tasks) to ([\w.-]+)(?::[ \t]*(.*?))?[ \t]*$/;
/**
 * A queue card's line of the command that queues its work from a terminal,
 * `` `splates lane queue 7` ``, which the card shows on its own row.
 */
const COMMAND_LINE = /^`splates [^`\n]+`[ \t]*$/gm;
