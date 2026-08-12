import { color, type Logger } from "@webappwiz/log";
import type { Fs } from "@webappwiz/sys";
import { age } from "./age";
import { fail } from "./exit";
import { checkTodo } from "./todo";
import type { Worktree } from "./worktree";
import type { WorktreeStore } from "./worktree-store";

const TODO = "TODO.md";

export interface Details {
	task: string;
	status: string;
	branch: string;
	base: string;
	worktree: string;
	lease: "held" | "stale" | "none";
	ahead: number | null;
	added: number | null;
	removed: number | null;
	age: string | null;
	escalation: string | null;
	todo: string | null;
	/** How the `TODO.md` departs from the shape the skill prescribes. */
	todoProblems: string[];
}

/**
 * One task in full: what `ls` shows for it, plus the `TODO.md` its agent
 * left at the worktree root. Reading a tree this way takes no lease, so it
 * cannot knock the agent driving it off its own work.
 */
export async function show(
	{ store, fs, log }: { store: WorktreeStore; fs: Fs; log: Logger },
	task: string,
	{ json = false } = {},
): Promise<void> {
	const worktree = await store.find(task);
	if (worktree.gone) {
		fail(
			"not_found",
			`no task '${task}': run \`arbor ls\` to see what there is`,
			{ task },
		);
	}
	const details = await taskDetails(worktree, fs);

	if (json) {
		log.info(JSON.stringify(details, null, "\t"));
		return;
	}
	log.info(report(details));
}

/**
 * Everything there is to say about one task. Split out so `dev` can render the
 * same fields this prints, rather than assembling its own and drifting.
 */
export async function taskDetails(
	worktree: Worktree,
	fs: Fs,
): Promise<Details> {
	const { state } = worktree;
	// A record whose worktree or branch is gone is still worth showing: the
	// status names what is wrong, and asking git about a branch that is not
	// there would only fill the fields with nulls.
	const stat = worktree.hasBranch ? await worktree.diffStat() : null;
	const todo = worktree.exists
		? await fs.read(`${worktree.path}/${TODO}`).catch(() => null)
		: null;
	return {
		task: worktree.task,
		status: worktree.status,
		branch: worktree.branch,
		base: worktree.base,
		worktree: worktree.path,
		lease: worktree.leaseStatus,
		ahead: worktree.hasBranch ? await worktree.commitsAhead() : null,
		added: stat?.added ?? null,
		removed: stat?.removed ?? null,
		age: state ? age(state.createdAt) : null,
		escalation: state?.escalations?.at(-1)?.reason ?? null,
		todo,
		todoProblems:
			todo === null
				? []
				: checkTodo(todo, {
						task: worktree.task,
						escalated: worktree.status === "escalated",
					}),
	};
}

function report(details: Details): string {
	const lines = [
		`${color.bold(details.task)} ${details.status}`,
		`  branch:    ${details.branch}`,
		`  base:      ${details.base}`,
		`  worktree:  ${details.worktree}`,
		`  lease:     ${details.lease}`,
		`  ahead:     ${details.ahead === null ? "?" : details.ahead}  ${diff(details)}`,
		`  age:       ${details.age ?? "?"}`,
	];
	if (details.escalation !== null) {
		lines.push(`  ${color.yellow(`escalated: ${details.escalation}`)}`);
	}
	if (details.todo !== null) {
		lines.push("", color.bold(TODO), details.todo.trimEnd());
		for (const problem of details.todoProblems) {
			lines.push(color.yellow(`  ${problem}`));
		}
	} else if (details.status !== "orphaned") {
		lines.push(
			"",
			color.yellow(`no ${TODO}: whoever picks this up starts from the diff`),
		);
	}
	return lines.join("\n");
}

function diff(details: Details): string {
	if (details.added === null || details.removed === null) {
		return "?";
	}
	return `${color.green(`+${details.added}`)} ${color.red(`-${details.removed}`)}`;
}
