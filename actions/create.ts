import { color } from "@webappwiz/log";
import type { Arbor } from "../lib/arbor";

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function create(arbor: Arbor, task: string): Promise<void> {
	if (!NAME.test(task)) {
		arbor.fail(
			"usage",
			`invalid task name '${task}': use lowercase letters, digits and dashes`,
			{ task },
		);
	}

	const found = await arbor.store.find(task);
	if (found.status === "stray") {
		arbor.fail(
			"exists",
			`branch ${found.branch} exists without a worktree — run \`arbor prune ${task}\` first`,
			{ task, branch: found.branch },
		);
	}
	if (!found.gone) {
		arbor.fail(
			"exists",
			`task '${task}' already exists — run \`arbor claim ${task}\``,
			{ task, worktree: found.path },
		);
	}

	const added = await arbor.store.create(task);
	if (added.code !== 0) {
		arbor.fail("usage", `git worktree add failed: ${added.stderr}`, { task });
	}

	const worktree = await (await arbor.store.find(task)).take();

	// A fresh worktree shares no untracked files with the repo: no node_modules,
	// no .env. That is what the hook is for.
	if (arbor.config.postCreate) {
		const { exitCode } = await arbor.shell.stream(arbor.config.postCreate, {
			cwd: worktree.path,
			env: {
				ARBOR_TASK: task,
				ARBOR_PORT: String(worktree.port),
				ARBOR_WORKTREE: worktree.path,
				ARBOR_TRUNK: arbor.config.trunk,
			},
		});
		if (exitCode !== 0) {
			// The worktree stays. Rolling back would throw away a tree the agent
			// can fix by hand and re-run the hook in.
			arbor.fail(
				"hook_failed",
				`postCreate hook failed (exit ${exitCode}); worktree left in place at ${worktree.path}`,
				{ task, worktree: worktree.path, port: worktree.port },
			);
		}
	}

	arbor.log.info(
		`${color.green("created")} ${task}\n  worktree: ${worktree.path}\n  branch:   ${worktree.branch}\n  port:     ${worktree.port}`,
	);
}
