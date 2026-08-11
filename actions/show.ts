import { color, type Logger } from "@webappwiz/log";
import type { Fs } from "@webappwiz/sys";
import { age } from "../lib/age";
import { fail } from "../lib/exit";
import { checkTodo } from "../lib/todo";
import type { WorktreeStore } from "../lib/worktree-store";

const TODO = "TODO.md";

interface Details {
	task: string;
	status: string;
	branch: string;
	worktree: string;
	lease: "live" | "cold" | "none";
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
 * One workstream in full: what `ls` shows for it, plus the `TODO.md` its agent
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
			`no task '${task}' — run \`arbor ls\` to see what there is`,
			{ task },
		);
	}

	const { state } = worktree;
	// A record whose worktree or branch is gone is still worth showing: the
	// status names what is wrong, and asking git about a branch that is not
	// there would only fill the fields with nulls.
	const stat = worktree.hasBranch ? await worktree.diffStat() : null;
	const todo = worktree.exists
		? await fs.read(`${worktree.path}/${TODO}`).catch(() => null)
		: null;
	const details: Details = {
		task: worktree.task,
		status: worktree.status,
		branch: worktree.branch,
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

	if (json) {
		log.info(JSON.stringify(details, null, "\t"));
		return;
	}
	log.info(report(details));
}

function report(d: Details): string {
	const lines = [
		`${color.bold(d.task)} ${d.status}`,
		`  branch:    ${d.branch}`,
		`  worktree:  ${d.worktree}`,
		`  lease:     ${d.lease}`,
		`  ahead:     ${d.ahead === null ? "?" : d.ahead}  ${diff(d)}`,
		`  age:       ${d.age ?? "?"}`,
	];
	if (d.escalation !== null) {
		lines.push(`  ${color.yellow(`escalated: ${d.escalation}`)}`);
	}
	if (d.todo !== null) {
		lines.push("", color.bold(TODO), d.todo.trimEnd());
		for (const problem of d.todoProblems) {
			lines.push(color.yellow(`  ${problem}`));
		}
	} else if (d.status !== "orphaned") {
		lines.push(
			"",
			color.yellow(`no ${TODO} — whoever picks this up starts from the diff`),
		);
	}
	return lines.join("\n");
}

function diff(d: Details): string {
	if (d.added === null || d.removed === null) {
		return "?";
	}
	return `${color.green(`+${d.added}`)} ${color.red(`-${d.removed}`)}`;
}
