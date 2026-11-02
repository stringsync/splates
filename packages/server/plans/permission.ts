import type { TaskRecord } from "../board";
import type { Reach } from "../projects";

/** Whether the board has queued or started every task a queue card names. */
export function queueIsSettled(
	proposal: PermissionProposal,
	todos: readonly TaskRecord[],
): boolean {
	const { lane, tasks } = proposal;
	const mine =
		lane === null
			? tasks.flatMap((id) => todos.filter((todo) => todo.id === id))
			: todos.filter((todo) => todo.lane === lane);
	const byTask = lane === null || mine.length === 1;
	return mine
		.filter((todo) => todo.takenBy === null)
		.every(
			(todo) =>
				todo.stage === "queued" || (!byTask && todo.unqueuedFor !== undefined),
		);
}

/** Whether `line` titles a permission card. */
export function asksPermission(line: string): boolean {
	return [
		LOOP_CARD,
		PERMISSION,
		GRANT_PERMISSION,
		EVALS_PERMISSION,
		RUN_PERMISSION,
	].some((each) => each.test(line));
}

/** What the permission card titled `line`, with `body` under it, asks; null for any other line. */
export function permissionOf(
	line: string,
	body: string,
): PermissionProposal | null {
	const loop = LOOP_CARD.exec(line);
	if (loop !== null) {
		return {
			action: "eval-loop",
			lane: null,
			tasks: [],
			title: null,
			body,
			loop: { id: loop[1] as string, version: Number(loop[2]) },
		};
	}
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
		let loop: { id: string; version: number } | undefined;
		const prose = body.split("\n").filter((each) => {
			const linked = /^Loop: `([a-zA-Z0-9][a-zA-Z0-9._-]*)` at (\d+)$/.exec(
				each,
			);
			if (linked !== null) {
				loop = { id: linked[1] as string, version: Number(linked[2]) };
				return false;
			}
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
				...(loop === undefined ? {} : { loop }),
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
 * A permission card an agent's reply ends with, asking the person to allow
 * what an agent never does itself: queue a lane or tasks, remove a lane, run
 * evals or a heavy command, or grant one project reach into another. The
 * card's buttons act on it.
 */
export interface PermissionProposal {
	/**
	 * What it asks: queue work, remove a lane with its tasks, run evals, run
	 * a heavy command, the whole test suite among them, or let one project
	 * reach further into another.
	 */
	action:
		| "queue"
		| "remove-lane"
		| "run-evals"
		| "run-command"
		| "grant"
		| "eval-loop";
	loop?: { id: string; version: number };
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
	loop?: { id: string; version: number };
	skill: string;
	scenarios: string[];
	baseline: string | null;
	/** Runs of each cell; the runner's own default when absent. */
	reps?: number;
}

const LOOP_CARD =
	/^## 🧪 Eval loop ([a-zA-Z0-9][a-zA-Z0-9._-]*) at (\d+)[ \t]*$/;

const EVALS_PERMISSION =
	/^## 🔐 Permission: run evals (\S+?)(?::[ \t]*(.*?))?[ \t]*$/;
/** A run-evals card's scenario: a list item that is one code span, then maybe a note. */
const EVAL_PROBE = /^[-*][ \t]+`([^`\s]+)`(?:[ \t].*)?$/;
const EVAL_BASELINE = /^Baseline:[ \t]*`([^`\s]+)`[ \t]*$/;
const EVAL_REPS = /^Repetitions:[ \t]*(\d+)[ \t]*$/;
const RUN_PERMISSION = /^## 🔐 Permission: run command(?::[ \t]*(.*?))?[ \t]*$/;
/** A run-command card's command: a line that is one code span. */
const RUN_COMMAND = /^`([^`\n]+)`[ \t]*$/;
// `## 🔐 Permission: queue lane <n>: <name>`, `queue #<n>, #<n>: <what>`
// (`queue <project> #<n>` for another project's tasks) or `remove lane <n>:
// <name>`; the older `## 📥 Queue ...` titles read as the queue ones.
const PERMISSION =
	/^## (?:🔐 Permission: (?:(remove) lane (\d+)|queue (?:lane (\d+)|(?:([\w.-]+) )?(#\d+(?:,[ \t]*#\d+)*)))|📥 Queue (?:lane (\d+)|(#\d+(?:,[ \t]*#\d+)*)))(?::[ \t]*(.*?))?[ \t]*$/;
const GRANT_PERMISSION =
	/^## 🔐 Permission: grant ([\w.-]+) (read|queue|tasks) to ([\w.-]+)(?::[ \t]*(.*?))?[ \t]*$/;
/**
 * A queue card's line of the command that queues its work from a terminal,
 * `` `splates lane queue 7` ``, which the card shows on its own row.
 */
const COMMAND_LINE = /^`splates [^`\n]+`[ \t]*$/gm;
