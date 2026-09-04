import { color, type Logger } from "webappwiz/log";
import { MarkdownWriter } from "webappwiz/md";
import type { Fs } from "webappwiz/system";
import type { Config } from "./config";
import { fail } from "./exit";
import type { Shell } from "./shell";
import type { WorktreeService } from "./worktree-service";

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const PLAN_FILE = "ARBOR.md";

export interface AddOptions {
	/** Branch the task starts from and merges onto. Defaults to the trunk. */
	base?: string;
}

export async function add(
	{
		service,
		shell,
		config,
		log,
		fs,
	}: {
		service: WorktreeService;
		shell: Shell;
		config: Config;
		log: Logger;
		fs: Fs;
	},
	task: string,
	{ base = config.trunk }: AddOptions = {},
): Promise<void> {
	if (!NAME.test(task)) {
		fail(
			"usage",
			`invalid task name '${task}': use lowercase letters, digits and dashes`,
			{ task },
		);
	}

	// A worktree gets its own empty submodule directories, so every task would
	// have to bootstrap them before anything builds. Refuse the repo instead.
	// Git only reads the superproject's top-level file, so there is nowhere else
	// to look; a stale one with no live gitlink refuses too, which is the safe
	// direction to be wrong in.
	if (await fs.exists(`${service.git.root}/.gitmodules`)) {
		fail(
			"usage",
			"this repo has git submodules (.gitmodules), which arbor does not support: worktrees do not share them",
			{ task },
		);
	}

	const found = await service.find(task);
	if (found.status === "stray") {
		fail(
			"exists",
			`branch ${found.branch} exists without a worktree: run \`arbor rm ${task}\` first`,
			{ task, branch: found.branch },
		);
	}
	if (!found.gone) {
		fail(
			"exists",
			`task '${task}' already exists: run \`arbor claim ${task}\``,
			{ task, worktree: found.path },
		);
	}

	const added = await service.add(task, { base });
	if (added.code !== 0) {
		// git's own "invalid reference" sends people to the branch, when what is
		// wrong is which branch arbor thinks the trunk is.
		const missingTrunk =
			base === config.trunk && !(await service.git.branchExists(base));
		fail(
			"usage",
			missingTrunk
				? `trunk '${base}' is not a branch in this repo: set \`trunk\` in arbor.config.ts`
				: `git worktree add failed: ${added.stderr}`,
			{ task },
		);
	}

	const worktree = await (await service.find(task)).take({ base });

	// The plan is scratch for one task and must never land on trunk. Excluding
	// it through the shared `.git` covers every worktree at once and leaves the
	// repo's own .gitignore, which arbor would have to commit to, alone.
	const info = `${await service.git.commonDir()}/info`;
	const excluded = await fs.read(`${info}/exclude`).catch(() => "");
	if (!excluded.split("\n").includes(PLAN_FILE)) {
		await fs.mkdir(info);
		await fs.write(
			`${info}/exclude`,
			`${excluded.trimEnd()}\n${PLAN_FILE}\n`.trimStart(),
		);
	}

	await fs.write(`${worktree.path}/${PLAN_FILE}`, PLAN(task));

	// A fresh worktree shares no untracked files with the repo: no node_modules,
	// no .env. That is what the hook is for.
	if (config.postCheckout) {
		const { exitCode } = await shell.stream(
			config.postCheckout,
			worktree.path,
			{
				env: {
					ARBOR_TASK: task,
					ARBOR_WORKTREE: worktree.path,
					ARBOR_TRUNK: config.trunk,
				},
			},
		);
		if (exitCode !== 0) {
			// The worktree stays. Rolling back would throw away a tree the agent
			// can fix by hand and re-run the hook in.
			fail(
				"hook_failed",
				`postCheckout hook failed (exit ${exitCode}); worktree left in place at ${worktree.path}`,
				{ task, worktree: worktree.path },
			);
		}
	}

	log.info(
		`${color.green("added")} ${task}\n  worktree: ${worktree.path}\n  branch:   ${worktree.branch}\n  base:     ${base}`,
	);
}

/** The plan a fresh task starts with. `## Goal` and `## Files` are left empty
 * on purpose: `arbor show` nags until the agent fills them in. */
function PLAN(task: string): string {
	return new MarkdownWriter()
		.heading(1, task)
		.heading(2, "Goal")
		.heading(2, "Files")
		.heading(2, "Next")
		.checklist("fill in Goal and list the steps here as `- [ ]` items")
		.toString();
}
