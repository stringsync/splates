import { color, type Logger } from "webappwiz/log";
import { MarkdownWriter } from "webappwiz/md";
import type { Fs } from "webappwiz/system";
import type { Config } from "./config";
import { fail } from "./exit";
import { PLAN_FILE } from "./plan";
import { pickAgent, type RosterAgent } from "./roster";
import type { Shell } from "./shell";
import type { Todo } from "./todo";
import { blockedWarning } from "./todo-take";
import type { Todos } from "./todos";
import type { Dispatched, Worktree } from "./worktree";
import type { WorktreeService } from "./worktree-service";

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface AddOptions {
	/** Branch the task starts from and merges onto. Defaults to the trunk. */
	base?: string;
	/**
	 * The todos this task takes up: their words seed the plan's Goal, and
	 * nobody else can take them while the task lives.
	 */
	todos?: number[];
	/**
	 * Runs once the worktree exists and before its record makes the task live,
	 * so whatever it tells of the task is in place before anyone can see it.
	 */
	onTree?: () => Promise<void>;
	/**
	 * The agent to hand the task to, which `arbor dev` starts in its tree once
	 * the tree is ready; its id must be one of `agents`.
	 */
	dispatch?: Dispatched;
	/** The roster's agents, which `dispatch` must name one of, and its model. */
	agents?: RosterAgent[];
}

export async function add(
	{
		service,
		shell,
		config,
		log,
		fs,
		todos,
	}: {
		service: WorktreeService;
		shell: Shell;
		config: Config;
		log: Logger;
		fs: Fs;
		todos: Todos;
	},
	task: string,
	{
		base = config.trunk,
		todos: ids = [],
		onTree,
		dispatch,
		agents = [],
	}: AddOptions = {},
): Promise<void> {
	if (!NAME.test(task)) {
		fail(
			"usage",
			`invalid task name '${task}': use lowercase letters, digits and dashes`,
			{ task },
		);
	}
	const handOff =
		dispatch === undefined
			? undefined
			: {
					...dispatch,
					...pickAgent(agents, dispatch.agent, dispatch.model, { task }),
				};

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
			`branch ${found.branch} exists without a worktree: run \`arbor remove ${task}\` first`,
			{ task, branch: found.branch },
		);
	}
	if (!found.gone) {
		refuseTaken(found);
	}

	// Looked up before anything is created, so a todo that is gone or taken
	// refuses the whole add instead of leaving a tree behind.
	const taken: Todo[] = [];
	const blocked: string[] = [];
	for (const id of new Set(ids)) {
		const todo = await todos.find(id);
		if (todo.takenBy) {
			await todo.take(task); // refuses, naming the task that has it
		}
		blocked.push(...blockedWarning(todo, await todo.blockers(task, ids)));
		taken.push(todo);
	}

	const added = await service.add(task, { base });
	if (added.code !== 0) {
		// Another add of this name got its branch in first, after we looked.
		const raced = await service.find(task);
		if (!raced.gone) {
			refuseTaken(raced);
		}
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

	await onTree?.();
	const worktree = await (await service.find(task)).take({
		base,
		...(handOff === undefined
			? {}
			: { dispatch: { ...handOff, pending: true } }),
	});

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

	await fs.write(
		`${worktree.path}/${PLAN_FILE}`,
		PLAN(task, taken.length === 0 ? null : goal(taken)),
	);
	for (const todo of taken) {
		await todo.take(task);
	}

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
			// No agent starts in a tree its hook left broken.
			if (handOff !== undefined) {
				await worktree.save({ dispatch: undefined });
			}
			// The worktree stays. Rolling back would throw away a tree the agent
			// can fix by hand and re-run the hook in.
			fail(
				"hook_failed",
				`postCheckout hook failed (exit ${exitCode}); worktree left in place at ${worktree.path}`,
				{ task, worktree: worktree.path },
			);
		}
	}

	// Ready only once the hook has readied the tree, so the agent never starts
	// in one still installing.
	if (handOff !== undefined) {
		await worktree.save({ dispatch: handOff });
	}

	log.info(
		[
			`${color.green("added")} ${task}`,
			`  worktree: ${worktree.path}`,
			`  branch:   ${worktree.branch}`,
			`  base:     ${base}`,
			...(handOff === undefined
				? []
				: [
						`  agent:    ${handOff.agent}${handOff.model === undefined ? "" : ` (${handOff.model})`}, which \`arbor dev\` starts in the worktree`,
					]),
			...blocked,
		].join("\n"),
	);
}

function refuseTaken(found: Worktree): never {
	fail(
		"exists",
		`task '${found.task}' already exists: run \`arbor claim ${found.task}\``,
		{ task: found.task, worktree: found.path },
	);
}

/**
 * Todos as a Goal: each one's subject and detail, and each file attached to it
 * by path, which stay readable until the task lands and takes the todo with
 * it. One todo is the Goal as it stands; several are each named by id.
 */
function goal(todos: Todo[]): string {
	return todos
		.map((todo) => {
			const subject =
				todos.length === 1 ? todo.subject : `Todo ${todo.id}: ${todo.subject}`;
			return [
				subject,
				todo.text,
				todo.files.map((path) => `Attached: \`${path}\``).join("\n"),
			]
				.filter(Boolean)
				.join("\n\n");
		})
		.join("\n\n");
}

/** The plan a fresh task starts with. `## Goal` is the todos it takes up, if
 * any; it is otherwise left empty on purpose: `arbor show` nags until the
 * agent fills it in. */
function PLAN(task: string, goal: string | null): string {
	const writer = new MarkdownWriter().heading(1, task).heading(2, "Goal");
	if (goal !== null) {
		writer.text(goal);
	}
	return writer
		.heading(2, "Next")
		.checklist("fill in Goal and list the steps here as `- [ ]` items")
		.toString();
}
