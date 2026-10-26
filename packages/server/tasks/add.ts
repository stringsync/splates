import { color, type Logger } from "webappwiz/log";
import { MarkdownWriter } from "webappwiz/md";
import type { Fs } from "webappwiz/system";
import { Duration, sleep } from "webappwiz/time";
import type { Task, Tasks } from "../board";
import { blockedWarning, checkSlug } from "../board";
import type { Config } from "../config";
import { fail } from "../exit";
import { pickAgent, type RosterAgent } from "../models";
import { PLAN_FILE, Plans } from "../plans";
import { BESIDE_GATE_NICE } from "../server/shared";
import type { Shell } from "../terminal";
import { TaskOverlaps } from "./overlaps";
import type { Dispatched, Worktree } from "./worktree";
import { taskOf, type WorktreeService } from "./worktree-service";

export interface AddOptions {
	/** Branch the task starts from and merges onto. Defaults to the trunk. */
	base?: string;
	/**
	 * The queued task this task starts, as a list of one: its words seed the
	 * plan's Goal, and nobody else can take it while the task lives.
	 */
	tasks?: number[];
	/**
	 * One or two lines on what done means, written under `## Goal` ahead of
	 * whatever the queued tasks seed it with.
	 */
	goal?: string;
	/**
	 * Runs once the worktree exists and before its record makes the task live,
	 * so whatever it tells of the task is in place before anyone can see it.
	 */
	onTree?: () => Promise<void>;
	/**
	 * The agent `splates server`'s queue hands the task to, which it starts in
	 * the task's tree once the tree is ready; its id must be one of `agents`.
	 * Never from an agent, which starts no agents.
	 */
	dispatch?: Dispatched;
	/** The roster's agents, which `dispatch` must name one of, and its model. */
	agents?: RosterAgent[];
	/** Added from another project, as `splates --project` does, which is refused. */
	away?: boolean;
}

export async function add(
	{
		service,
		shell,
		config,
		log,
		fs,
		tasks: queue,
	}: {
		service: WorktreeService;
		shell: Shell;
		config: Config;
		log: Logger;
		fs: Fs;
		tasks: Tasks;
	},
	task: string,
	{
		base = config.trunk,
		tasks: ids = [],
		goal: asked,
		onTree,
		dispatch,
		agents = [],
		away = false,
	}: AddOptions = {},
): Promise<void> {
	if (away) {
		fail(
			"not_granted",
			"a task in another project is that project's to start: queue it there with `splates --project <slug> task add`",
			{ task },
		);
	}
	if (ids.length > 1) {
		fail(
			"usage",
			`a task starts one queued task: start #${ids[0]} alone, and fold any other that asks the same into it by \`splates task remove\` and its words in the Goal`,
			{ task, tasks: ids },
		);
	}
	checkSlug(task, { task });
	// Agents start no agents, so they never multiply: work goes to the queue,
	// whose worker starts it. The server starts its tasks with neither set.
	const asking =
		service.ps.env("SPLATES_CONVERSATION") ??
		service.ps.env("SPLATES_STARTED_BY");
	if (dispatch !== undefined && asking !== undefined) {
		fail(
			"usage",
			"an agent starts no agents: queue the work with `splates task add`, and a worker starts it, or do it yourself",
			{ task, caller: asking },
		);
	}
	// A subagent works in the tree of the task it helps, so the person reviews
	// one body of work; parts on its branch are from before that.
	if (taskOf(base) !== null && asking !== undefined) {
		fail(
			"usage",
			"a subagent works in your own worktree, with no task of its own: have it commit there, and `splates task add` what should land apart",
			{ task, base },
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
			"this repo has git submodules (.gitmodules), which splates does not support: worktrees do not share them",
			{ task },
		);
	}

	const found = await settled(service, task);
	if (!found.gone) {
		refuseFound(found);
	}

	// Taken before anything is created, so a queued task that is gone, or
	// taken by another add racing this one, refuses the whole add instead of
	// leaving a tree behind. Taken before the record is first written, which
	// starts the task under the lowest number among them.
	const taken: Task[] = [];
	const blocked: string[] = [];
	const tookNow: Task[] = [];
	try {
		for (const id of new Set(ids)) {
			const each = await queue.find(id);
			const had = each.takenBy === task;
			// Refuses, naming the task that has it.
			const took = await each.take(task);
			if (!had) {
				tookNow.push(took);
			}
			// Asked of it as it was, since a task it takes blocks none of it.
			blocked.push(...blockedWarning(each, await each.blockers(task, ids)));
			taken.push(took);
		}
	} catch (error) {
		await letGo(tookNow);
		throw error;
	}

	const added = await service.add(task, { base });
	if (added.code !== 0) {
		await letGo(tookNow);
		// Another add of this name got its branch in first, after we looked.
		const raced = await settled(service, task);
		if (!raced.gone) {
			refuseFound(raced);
		}
		// git's own "invalid reference" sends people to the branch, when what is
		// wrong is which branch splates thinks the trunk is.
		const missingTrunk =
			base === config.trunk && !(await service.git.branchExists(base));
		fail(
			"usage",
			missingTrunk
				? `trunk '${base}' is not a branch in this repo: set \`trunk\` in splates.config.ts`
				: `git worktree add failed: ${added.stderr}`,
			{ task },
		);
	}

	await onTree?.();
	// An agent `splates server` started has its conversation in its env: the page
	// nests the task under it, as for a subagent's task landing on trunk.
	const caller = service.ps.env("SPLATES_CONVERSATION");
	const worktree = await (await service.find(task)).take({
		base,
		...(caller === undefined ? {} : { caller }),
		...(handOff === undefined
			? {}
			: { dispatch: { ...handOff, pending: true } }),
	});

	await new Plans(fs).exclude(await worktree.git.commonDir());

	await fs.write(
		`${worktree.path}/${PLAN_FILE}`,
		PLAN(
			task,
			[asked?.trim(), taken.length === 0 ? "" : goal(taken)]
				.filter(Boolean)
				.join("\n\n") || null,
		),
	);

	// A fresh worktree shares no untracked files with the repo: no node_modules,
	// no .env. That is what the hook is for. Its install runs niced, so a
	// merge gate on the machine keeps the CPU.
	const hook = config.postCheckout;
	if (hook) {
		const { exitCode } = await shell.stream(hook, worktree.path, {
			nice: BESIDE_GATE_NICE,
			env: {
				SPLATES_TASK: task,
				SPLATES_WORKTREE: worktree.path,
				SPLATES_TRUNK: config.trunk,
			},
		});
		if (exitCode !== 0) {
			// No agent starts in a tree its hook left broken.
			if (handOff !== undefined) {
				await worktree.save({ dispatch: undefined });
			}
			// The queued task goes back on the list, or it would leave the queue
			// with no agent on it.
			await letGo(tookNow);
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
	// in one still installing. Its lease goes with it: this command drives
	// the tree no further.
	if (handOff !== undefined) {
		await worktree.save({ dispatch: handOff, lease: null });
	}

	const overlaps = await new TaskOverlaps(service).warnings(
		task,
		[asked, ...taken.map((each) => `${each.subject}\n${each.text}`)]
			.filter(Boolean)
			.join("\n"),
		(await worktree.changedFiles()) ?? [],
	);
	log.info(
		[
			`${color.green("added")} ${task}`,
			`  worktree: ${worktree.path}`,
			`  branch:   ${worktree.branch}`,
			`  base:     ${base}`,
			...(handOff === undefined
				? []
				: [
						`  agent:    ${handOff.agent}${handOff.model === undefined ? "" : ` (${handOff.model})`}, which \`splates server\` starts in the worktree`,
					]),
			...blocked,
			...overlaps.map((warning) => color.yellow(`  ${warning}`)),
		].join("\n"),
	);
}

/**
 * How long a branch with no tree may be another add's, between `git worktree
 * add` making the branch and the tree's directory, before it counts as stray.
 */
const STRAY_SETTLE = Duration.secs(2);
const STRAY_POLL = Duration.ms(50);

/**
 * `task` as `find` gives it, but a stray branch is looked at again until its
 * tree turns up or `STRAY_SETTLE` passes: an add racing this one has its
 * branch a moment before its tree, which is no stray to remove.
 */
async function settled(
	service: WorktreeService,
	task: string,
): Promise<Worktree> {
	const deadline = Date.now() + STRAY_SETTLE.ms;
	let found = await service.find(task);
	while (found.status === "stray" && Date.now() < deadline) {
		await sleep(STRAY_POLL);
		found = await service.find(task);
	}
	return found;
}

function refuseFound(found: Worktree): never {
	if (found.status === "stray") {
		fail(
			"exists",
			`branch ${found.branch} exists without a worktree: run \`splates remove ${found.task}\` first`,
			{ task: found.task, branch: found.branch },
		);
	}
	fail(
		"exists",
		`task '${found.task}' already exists: run \`splates claim ${found.task}\``,
		{ task: found.task, worktree: found.path },
	);
}

/**
 * Queued tasks as a Goal: each one's subject and detail, and each file attached
 * to it by path, which stay readable until the task lands and takes the queued
 * task with it. One is the Goal as it stands; several are each named by number.
 */
function goal(queued: Task[]): string {
	return queued
		.map((each) => {
			const subject =
				queued.length === 1 ? each.subject : `Task ${each.id}: ${each.subject}`;
			return [
				subject,
				each.text,
				each.files.map((path) => `Attached: \`${path}\``).join("\n"),
			]
				.filter(Boolean)
				.join("\n\n");
		})
		.join("\n\n");
}

/** The plan a fresh task starts with: `## Goal`, the Goal it was given and
 * the queued tasks it takes up. `splates add` refuses a task with neither, so
 * only a caller that skips the CLI leaves it empty, which `splates show` nags
 * about. Its agent adds `## Next` when the work takes several commits. */
function PLAN(task: string, goal: string | null): string {
	const writer = new MarkdownWriter().heading(1, task).heading(2, "Goal");
	if (goal !== null) {
		writer.text(goal);
	}
	return writer.toString();
}

/** Puts back on the list the queued tasks an add took and then gave up on. */
async function letGo(tasks: readonly Task[]): Promise<void> {
	for (const each of tasks) {
		await each.release();
	}
}
