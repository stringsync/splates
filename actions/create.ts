import { color, type Logger } from "@webappwiz/log";
import type { Config } from "../lib/config";
import type { Failures } from "../lib/failures";
import type { Shell } from "../lib/shell";
import type { WorktreeStore } from "../lib/worktree-store";

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function create(
	{
		store,
		shell,
		config,
		log,
	}: {
		store: WorktreeStore;
		shell: Shell;
		config: Config;
		log: Logger;
	},
	failures: Failures,
	task: string,
): Promise<void> {
	if (!NAME.test(task)) {
		failures.fail(
			"usage",
			`invalid task name '${task}': use lowercase letters, digits and dashes`,
			{ task },
		);
	}

	const found = await store.find(task);
	if (found.status === "stray") {
		failures.fail(
			"exists",
			`branch ${found.branch} exists without a worktree — run \`arbor prune ${task}\` first`,
			{ task, branch: found.branch },
		);
	}
	if (!found.gone) {
		failures.fail(
			"exists",
			`task '${task}' already exists — run \`arbor claim ${task}\``,
			{ task, worktree: found.path },
		);
	}

	const added = await store.create(task);
	if (added.code !== 0) {
		failures.fail("usage", `git worktree add failed: ${added.stderr}`, {
			task,
		});
	}

	const worktree = await (await store.find(task)).take();

	// A fresh worktree shares no untracked files with the repo: no node_modules,
	// no .env. That is what the hook is for.
	if (config.postCreate) {
		const { exitCode } = await shell.stream(config.postCreate, {
			cwd: worktree.path,
			env: {
				ARBOR_TASK: task,
				ARBOR_PORT: String(worktree.port),
				ARBOR_WORKTREE: worktree.path,
				ARBOR_TRUNK: config.trunk,
			},
		});
		if (exitCode !== 0) {
			// The worktree stays. Rolling back would throw away a tree the agent
			// can fix by hand and re-run the hook in.
			failures.fail(
				"hook_failed",
				`postCreate hook failed (exit ${exitCode}); worktree left in place at ${worktree.path}`,
				{ task, worktree: worktree.path, port: worktree.port },
			);
		}
	}

	log.info(
		`${color.green("created")} ${task}\n  worktree: ${worktree.path}\n  branch:   ${worktree.branch}\n  port:     ${worktree.port}`,
	);
}
