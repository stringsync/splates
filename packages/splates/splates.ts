// vet-ignore-file compact-files: the root roster of top-level commands and their flags, each body handed to its own module and each group mounted from its own file

import { agents } from "@splates/server/agents";
import { attach } from "@splates/server/artifacts";
import { commaList } from "@splates/server/comma-list";
import { refuseGroomer } from "@splates/server/conversations";
import { exits, fail } from "@splates/server/exit";
import { DEFAULT_COUNT, log as showLog } from "@splates/server/log";
import { merge, mergeOnServer } from "@splates/server/merge";
import { portsLs } from "@splates/server/ports";
import { forget, init } from "@splates/server/projects";
import type { Facts, Repository } from "@splates/server/records";
import {
	MIGRATING,
	MIGRATION_LIMIT,
	migrateRecords,
	OpenBoards,
	repository,
} from "@splates/server/records";
import type { SplatesDeps } from "@splates/server/server";
import {
	newest,
	recordsFirst,
	refreshHere,
	rosterOf,
	seeded,
	update,
} from "@splates/server/server";
import { addFactTasks } from "@splates/server/stats";
import {
	add,
	checkpoint,
	claim,
	DEFAULT_TIMEOUT,
	follow,
	list,
	path,
	REMOVE_REASONS,
	recordRetry,
	remove,
	serveProject,
	show,
	untilAfter,
	wait,
} from "@splates/server/tasks";
import { serverOf } from "@splates/server/workers";
import { cli } from "core/cmd";
import { Duration } from "core/time";
import { z } from "zod";
import { splatesArtifact } from "./artifact";
import { blockerFlags } from "./blockers";
import { splatesBoard } from "./board";
import { splatesCreds } from "./creds";
import { splatesEvals } from "./evals";
import { effortIn, folderOf, here, offeredOf, taskIds } from "./flags";
import { splatesHook } from "./hook";
import { splatesLane } from "./lane";
import { printMachine } from "./machine";
import { runProgress } from "./progress";
import { splatesProjects } from "./projects";
import { splatesQueue } from "./queue";
import { splatesReplica } from "./replica";
import { splatesServer } from "./server";
import { setup } from "./setup";
import { splatesShip } from "./ship";
import { splatesSlots } from "./slots";
import { splatesTask } from "./task";
import { splatesTunnel } from "./tunnel";
import { splatesWorker } from "./worker";

/**
 * Splits a leading `--project <slug>`, or `--project=<slug>`, off the
 * arguments, for `run` to be handed as `project`.
 */
export function projectArgs(argv: string[]): {
	project?: string;
	argv: string[];
} {
	const [first, second, ...rest] = argv;
	if (first === "--project" && second !== undefined) {
		return { project: second, argv: rest };
	}
	if (first?.startsWith("--project=")) {
		return {
			project: first.slice("--project=".length),
			argv: argv.slice(1),
		};
	}
	return { argv };
}

// Outermost first: a refusal raised in an action unwinds past `repository` and
// stops at `exits`, which is the only thing that ends the process.
export const splates = cli<SplatesDeps>("splates").use(exits<SplatesDeps>());

// Every action is handed the dependencies it runs with, so it passes the
// context straight on: each command takes the few it names off it.

splates
	.command("init")
	.use(repository({ creates: true, needs: "own" }))
	.description(
		"make this repository a splates project: set up its records under .git/splates when it has none, install the splates skill of this release with `bunx skills add`, and register it in ~/.splates/projects.json, so `splates server` serves it beside every other; run again, it changes only what is not so already",
	)
	.action((_opts, ctx) => init(ctx));

splates
	.command("migrate")
	.description(
		`move this repository's records under .git/splates to this splates's format, as \`splates server\` does as it starts: backed up first, the steps run with ${MIGRATION_LIMIT.human()} to finish, and the backup put back if one fails or runs over, with why kept in .git/splates-migration.json; it tries again past a failure kept there, which the server and every other command leave alone. Run it only while no older \`splates server\` serves the repository, which would refuse the records once moved; \`splates update\` restarts one first`,
	)
	.action(async (_opts, ctx) => {
		const format = await migrateRecords(ctx);
		if (ctx.ps.env(MIGRATING) === undefined) {
			ctx.log.info(`splates's records are in format ${format}`);
		}
	});

splates
	.command("update")
	.use(recordsFirst())
	.use(repository({ needs: "own" }))
	.description(
		"bring this repository up to the newest splates on npm: run `update` on that release when it is newer than this one, which moves the records under .git/splates to its format, as `splates migrate` does, unless an older `splates server` serves the repository, which it asks to restart onto that release once its agents have checkpointed, migrating them as it starts; then installs its splates skill with `bunx skills add` over the copy there, leaving one that links to your own; commit what changed",
	)
	.action(async (_opts, ctx) => {
		const code = await update({
			root: ctx.git.root,
			fs: ctx.fs,
			ps: ctx.ps,
			log: ctx.log,
			newest: () => newest(),
		});
		if (code !== 0) {
			ctx.ps.exit(code);
		}
	});

splates
	.command("refresh")
	.description(
		"bring the tree you stand in, a task's worktree included, up to this splates: install its splates skill with `bunx skills add` over the copy there and move what an older config holds to where it reads it, leaving the records and any `splates server` alone; what a project runs once a ship's bump task has installed a newer splates, as splates's `afterBump` names; commit what changed",
	)
	.action((_opts, ctx) => refreshHere(ctx));

splates
	.command("forget")
	.use(repository({ needs: "own" }))
	.description(
		"take this repository off ~/.splates/projects.json, so `splates server` no longer offers it; its records stay, and `splates init` brings it back",
	)
	.action((_opts, ctx) => forget(ctx));

splates
	.command("add")
	.use(repository({ needs: "tasks" }))
	.description(
		"start a task: a new one, or with --task one from the queue; create branch task/<slug>, a worktree at ../<repo>-splates.noindex/<slug> and a state record",
	)
	.arg("slug", z.string(), {
		description:
			"the task's name, for its branch and worktree (lowercase-with-dashes)",
	})
	.option("base", z.string(), {
		default: "",
		description:
			"branch this task starts from and merges onto (default: trunk); `task/<other>` stacks this task on that one and lands the work in its worktree",
	})
	.option("project", z.string(), {
		default: "",
		description:
			"the project of splates.config.ts the task changes (default: the queued task's, else the one whose folder you run it in, else the only project)",
	})
	.repeated("tag", z.string(), {
		description:
			"a tag grouping the task, comma separated or the flag repeated; splates.config.ts may allow only some, or require one (default: the allowed tag whose folder you run it in)",
	})
	.option("task", z.string(), {
		default: "",
		description:
			"start this queued task by number: its words become the plan's Goal, merging removes it, and removing this task puts it back where it was",
	})
	.option("goal", z.string(), {
		default: "",
		description:
			"one or two lines on what done means, written under `## Goal` in the task's SPLATES.md; required unless --task seeds the Goal",
	})
	.option("agent", z.string(), {
		default: "",
		description:
			"how `splates server`'s queue hands the task to an agent on the roster (`splates agents`), which it starts in the worktree; refused from an agent, which starts no agents and queues work with `splates task add` instead",
	})
	.option("model", z.string(), {
		default: "",
		description:
			"with --agent: the model it works on, by its id or name on the roster (default: the agent's own)",
	})
	.option("effort", z.string(), {
		default: "",
		description:
			"with --agent: the thinking level it works at, one the agent offers (default: the agent's own)",
	})
	.option("prompt", z.string(), {
		default: "",
		description:
			"with --agent: what to tell the agent beyond claiming the task",
	})
	.option("held", z.string(), {
		default: "",
		description:
			"with --agent: the conversation `splates server`'s queue held for the queued task, which takes the task rather than a new one",
	})
	.action(async (opts, ctx) => {
		await refuseGroomer(ctx.service, "add");
		if (
			opts.agent === "" &&
			(opts.model !== "" ||
				opts.effort !== "" ||
				opts.prompt !== "" ||
				opts.held !== "")
		) {
			fail("usage", "--model, --effort, --prompt and --held go with --agent", {
				task: opts.slug,
			});
		}
		if (opts.goal.trim() === "" && opts.task === "") {
			fail(
				"usage",
				`say what done means: \`splates add ${opts.slug} --goal "<one or two lines>"\`, or start queued tasks with --task`,
				{ task: opts.slug },
			);
		}
		const dispatch =
			opts.agent === ""
				? undefined
				: {
						agent: opts.agent,
						...(opts.model === "" ? {} : { model: opts.model }),
						...(await effortIn(ctx, opts.agent, opts.effort, {
							task: opts.slug,
						})),
						...(opts.prompt === "" ? {} : { prompt: opts.prompt }),
						...(opts.held === "" ? {} : { held: opts.held }),
					};
		const agents = dispatch === undefined ? [] : await seeded(rosterOf(ctx));
		const all = await ctx.tasks.all();
		const subjects = taskIds(opts.task).flatMap(
			(id) => all.find((each) => each.id === id)?.subject ?? [],
		);
		const folder = await folderOf(ctx);
		await ctx.journal.record(
			"add",
			opts.slug,
			() =>
				add(ctx, opts.slug, {
					base: opts.base || undefined,
					tasks: taskIds(opts.task),
					goal: opts.goal.trim() || undefined,
					project: opts.project || undefined,
					folder,
					tag: opts.tag,
					dispatch,
					agents,
					away: ctx.elsewhere !== null,
					// Before the task is live, or the page shows it a moment as an
					// external agent's. A task handed to another agent is that
					// agent's, so this conversation stays where it is.
					onTree:
						dispatch === undefined
							? () => follow(ctx, opts.slug, { base: opts.base || undefined })
							: undefined,
				}),
			{
				base: opts.base || ctx.config.trunk,
				tasks: taskIds(opts.task),
				goal: opts.goal.trim() || null,
				subjects,
				agent: dispatch?.agent ?? null,
				model: dispatch?.model ?? null,
			},
		);
		if (ctx.elsewhere !== null) {
			await serveProject(ctx);
		}
	});

splates
	.command("claim")
	.use(repository({ needs: "own" }))
	.description(
		"resume an existing task: take ownership of its worktree and print its path, status and any half-finished rebase; refuses while another agent holds the lease, but takes a stale one silently, so `splates show` first if the tree may not be abandoned",
	)
	.arg("task", z.string(), { description: "task name" })
	.action(async (opts, ctx) => {
		await ctx.journal.record(
			"claim",
			opts.task,
			() => claim(ctx, opts.task),
			(claimed) => claimed,
		);
		await printOpenQuestions(ctx, opts.task);
		await follow(ctx, opts.task);
	});

/**
 * Prints the question cards the task's conversation asked that nobody has
 * answered, for an agent resuming it; says nothing with no server to ask.
 */
async function printOpenQuestions(
	ctx: SplatesDeps & Repository,
	task: string,
): Promise<void> {
	const server = await serverOf(ctx);
	const slug = (await ctx.projects.list()).find(
		(each) => each.root === ctx.git.root,
	)?.slug;
	if (server === null || slug === undefined) {
		return;
	}
	const response = await server
		.send(
			`${server.url}/api/tasks/${encodeURIComponent(task)}/questions?project=${encodeURIComponent(slug)}`,
			{ headers: { origin: server.url }, signal: AbortSignal.timeout(5000) },
		)
		.catch(() => null);
	if (response === null || !response.ok) {
		return;
	}
	const { questions } = (await response.json().catch(() => ({}))) as {
		questions?: { number: string; text: string }[];
	};
	if (questions === undefined || questions.length === 0) {
		return;
	}
	ctx.log.info(
		[
			"  open questions, asked in the conversation and not yet answered:",
			...questions.map((asked) => `    ${asked.number}. ${asked.text}`),
		].join("\n"),
	);
}

splates
	.command("merge")
	.use(repository({ needs: "own" }))
	.description(
		"land this worktree's branch on its base (trunk unless created with --base): rebase onto it, run tests on the rebased code, fast-forward it in whichever worktree has it checked out, then discard the worktree, branch and record (linear history, never a merge commit, no flag to skip tests); requires committed work, refusing a dirty worktree",
	)
	.option("message", z.string(), {
		default: "",
		description:
			"squash the task's commits into one with this message before landing, saying what the base gains in at least 5 characters",
	})
	.action(async (opts, ctx) => {
		await refuseGroomer(ctx.service, "merge");
		const task = await here(ctx);
		// Filled by `merge` as it learns each; a refusal keeps what it had.
		const facts: Partial<Facts["merge"]> = {};
		await ctx.journal.record(
			"merge",
			task,
			() => mergeServed(ctx, task, facts, opts.message),
			facts as Facts["merge"],
		);
		if (task !== null) {
			// After the merge's own event, so the conversation says it landed
			// before what it found; landed is landed, whatever happens here.
			await addFactTasks(ctx, task).catch((error: unknown) =>
				ctx.log.error(
					`could not queue tasks for what the merge found: ${error}`,
				),
			);
			await follow(ctx, null, { from: task });
		}
	});

/**
 * Hands the merge to the `splates server` the agent runs under, so it runs
 * the server's merge code in the server's line; with none to reach, or a
 * central remote, merges here.
 */
async function mergeServed(
	ctx: SplatesDeps & Repository,
	task: string | null,
	facts: Partial<Facts["merge"]>,
	message: string,
): Promise<void> {
	const cwd = ctx.ps.cwd();
	const server = await serverOf(ctx);
	const slug = (await ctx.projects.list()).find(
		(each) => each.root === ctx.git.root,
	)?.slug;
	// With a central remote, workers on other machines merge as before: their
	// worktrees are not on the server's disk.
	const local = ctx.config.remote === null;
	if (server !== null && slug !== undefined && task !== null && local) {
		const served = await mergeOnServer(
			{ server, slug, log: ctx.log },
			{
				task,
				cwd,
				pid: ctx.ps.pid,
				hostname: ctx.ps.hostname,
				env: environment(),
				message,
			},
			facts,
		);
		if (served === "landed") {
			// The worktree is gone with the task.
			ctx.ps.cd(ctx.git.root);
			return;
		}
		ctx.log.error(
			`the splates server at ${server.url} could not be reached, or runs no merges yet: merging here, alone`,
		);
	}
	await merge(ctx, cwd, facts, { message });
}

/** This command's environment, which a merge the server runs gates with. */
function environment(): Record<string, string> {
	return Object.fromEntries(
		Object.entries(process.env).filter(
			(each): each is [string, string] => each[1] !== undefined,
		),
	);
}

splates
	.command("remove")
	.use(repository({ needs: "tasks" }))
	.description(
		"discard a task: worktree, branch and board tasks; cheap and encouraged, since redoing a task against current trunk often beats a hard rebase",
	)
	.arg("task", z.string(), { description: "task name" })
	.option("force", z.boolean(), {
		default: false,
		description: "discard even when another agent holds the lease",
	})
	.option("reason", z.optional(z.enum(REMOVE_REASONS)), {
		description:
			"why, for the Stats page: nothing (nothing to change), moot (no longer needed), superseded (done some other way), redo (better redone against current trunk), blocked (set aside until what it waits on lands, so back on the list, which takes --why and at least one blocker)",
	})
	.option("why", z.string(), {
		default: "",
		description:
			"with --reason blocked: what you found that stops the work, in a sentence or two, for the person and whoever takes it next",
	})
	.repeated("blocked-by", z.string(), {
		description:
			"with --reason blocked: the tasks it waits on to merge, comma separated or the flag repeated: a number for one here, <project>#<number> for one of another project",
	})
	.repeated("ask", z.string(), {
		description:
			"with --reason blocked: a question only the person can answer, in the skill's question format; repeat the flag for each",
	})
	.repeated("waiting-on", z.string(), {
		description:
			"with --reason blocked: something outside splates it waits on, such as a key or an upstream release; repeat the flag for each",
	})
	.option("detail", z.string(), {
		default: "",
		description:
			"with --reason blocked: the task's detail rewritten for whoever takes it next: why it stopped, what you found, the steps done and left, and where any pushed work is",
	})
	.action(async (opts, ctx) => {
		using boards = new OpenBoards(ctx, ctx.projects);
		const { blockedBy, blockedElsewhere } = await blockerFlags({
			boards,
			here: ctx.git.root,
			blockedBy: opts["blocked-by"],
		});
		await ctx.journal.record(
			"remove",
			opts.task,
			() =>
				remove(ctx, opts.task, {
					force: opts.force,
					reason: opts.reason,
					deferral: {
						why: opts.why,
						blockedBy,
						blockedElsewhere,
						questions: opts.ask,
						outside: opts["waiting-on"],
						detail: opts.detail === "" ? undefined : opts.detail,
					},
				}),
			({ released }) => ({ why: opts.reason ?? null, released }),
		);
		await follow(ctx, null, { from: opts.task });
	});

splates
	.command("list")
	.use(repository({ needs: "read" }))
	.description(
		"list every started task: its number, name, status (a merge waiting its turn adds its place in the server merge queue, `merging (queued 2)`), lease (held: an agent is on it now; stale: gone quiet, normal for a task mid-edit; none), commits ahead of trunk, age; `splates task list` lists the queue",
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.option("files", z.boolean(), {
		default: false,
		description:
			"add each task's Goal and changed files (committed or not), to check for overlap before starting",
	})
	.option("tag", z.string(), {
		default: "",
		description: "only the tasks with this tag",
	})
	.action((opts, ctx) =>
		list(ctx, {
			json: opts.json,
			files: opts.files,
			tag: opts.tag || undefined,
		}),
	);

splates
	.command("show")
	.use(repository({ needs: "read" }))
	.description(
		"read one task without touching it: everything `list` shows for it, plus the SPLATES.md its agent left at the worktree root; takes no lease, so it cannot knock that agent off its own tree; for a task no longer live, the newest finished one of that name: how it ended, its base, the commit it landed as, its conversation and the SPLATES.md it ended on",
	)
	.arg("task", z.string(), { description: "task name" })
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => show(ctx, opts.task, { json: opts.json }));

splates
	.command("wait")
	.use(repository({ needs: "read" }))
	.description(
		"block until a task stops moving: waiting on a person to answer its questions, or gone (merged or removed), or broken; takes no lease, and gives up with `timeout` rather than waiting forever",
	)
	.arg("task", z.string(), { description: "task name" })
	.option("timeout-secs", z.coerce.number(), {
		default: DEFAULT_TIMEOUT.secs,
		description: "how long to wait before giving up",
	})
	.action((opts, ctx) => {
		const timeout = Duration.secs(opts["timeout-secs"]);
		return ctx.journal.waiting(
			"wait",
			opts.task,
			{ until: untilAfter(timeout) },
			() => wait(ctx, opts.task, { timeout }),
		);
	});

splates
	.command("log")
	.use(repository({ needs: "read" }))
	.description(
		"show what has been done here recently: one line per add, claim, merge, remove, retry, queued task and more, with how it ended; outlives the tasks themselves",
	)
	.option("count", z.coerce.number(), {
		default: DEFAULT_COUNT,
		description: "how many entries to show",
	})
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => showLog(ctx, { count: opts.count, json: opts.json }));

splates.mount("server", splatesServer);

splates
	.command("machine")
	.description(
		"say how hard this machine is working and whether it is busy, as the page's Busy says: CPU or memory at 90% or the hottest sensor at 95°C. Needs no server. Read it before a command you expect to be heavy: run the command when the machine is not busy, and ask with a run-command card when it is",
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => printMachine(ctx, opts));

splates
	.command("ports")
	.description(
		"list the ports tasks serve, found by the running `splates server` as an editor finds ports to forward: each port a process in a task's worktree, or under its agent, listens on, with its link through the ports host `splates server --ports-host` saved, behind Cloudflare Access, and its link on this machine; give the user both",
	)
	.arg("task", z.string(), {
		default: "",
		description: "only this task's ports; every task's by default",
	})
	.option("dev", z.string(), {
		default: "",
		description:
			"the `splates server` to ask, a URL such as http://localhost:4310; by default the one an agent runs under, from SPLATES_DEV, else this machine's on its default port",
	})
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) =>
		portsLs({
			task: opts.task,
			dev: opts.dev,
			json: opts.json,
			log: ctx.log,
			ps: ctx.ps,
			send: ctx.fetch,
		}),
	);

splates
	.command("agents")
	.description(
		"print the roster of agents splates can start, kept for every project in ~/.splates/agents.json: each agent's launch command and models, with what each model is good at and what it costs, and the thinking levels `--effort` takes, as the agent offered them when last started, for choosing whom to delegate to; writes the defaults (Claude, Codex) there first when there is none, and `splates server` starts conversations with those it lists",
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action(async (opts, ctx) =>
		agents(
			{
				roster: rosterOf(ctx),
				offered: await offeredOf(ctx).all(),
				log: ctx.log,
			},
			{ json: opts.json },
		),
	);

splates
	.command("setup")
	.description(
		"set splates up on this machine, one step at a time: with no step, each area's steps, checked from real state, and the one to do next; with a step, why it matters, the one thing the user does and what the agent does. Skips are kept in ~/.splates/setup.json, so a skipped step stops asking",
	)
	.arg("step", z.string(), {
		default: "",
		description: "a step's id; omit for every area's progress",
	})
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.option("skip", z.boolean(), {
		default: false,
		description: "with a step: stop asking for it",
	})
	.option("unskip", z.boolean(), {
		default: false,
		description: "with a step: ask for it again",
	})
	.option("undo", z.boolean(), {
		default: false,
		description:
			"with an area's id in place of a step: print what undoing it would remove, the creds it forgets and keeps, and what only the user can remove; the Setup page's Undo does it, after the user confirms",
	})
	.action((opts, ctx) => setup(ctx, opts));

splates
	.command("path")
	.use(repository({ needs: "read" }))
	.description(
		"print a task's worktree path, or the main tree with no task; names another agent's tree without taking its lease",
	)
	.arg("task", z.string(), {
		default: "",
		description: "task name; omit for the main tree",
	})
	.action((opts, ctx) => path(ctx, opts.task || undefined));

splates
	.command("checkpoint")
	.use(repository({ needs: "own" }))
	.description(
		"save this task to the central remote (`remote` in splates.config.ts) before a stop: commit what is uncommitted as a `WIP: checkpoint` commit, to squash before merging, and push the branch as `splates/<task>`, so a worker that dies loses nothing; with no remote configured, leaves the tree as it is",
	)
	.action(async (_opts, ctx) => {
		await checkpoint(ctx, ctx.ps.cwd());
	});

splates
	.command("attach")
	.use(repository({ needs: "own" }))
	.description(
		"store screenshots and recordings for this task's questions to show: prints the path each was stored at, under .git/splates, which the `splates server` page shows inline; from a conversation (its $SPLATES_CONVERSATION, or --conversation) they stay with it past the task, otherwise they go when the task merges or is removed; those the task's final SPLATES.md shows are copied to keep with its finished record. A task holds at most attachmentCapacity bytes; with no files, lists what it holds. A file the user will come back for on its own is an artifact instead (`splates artifact add`)",
	)
	.arg("files", z.string(), {
		default: "",
		description: "files to store, comma separated",
	})
	.option("task", z.string(), {
		default: "",
		description: "task name, when run outside its worktree",
	})
	.option("remove", z.string(), {
		default: "",
		description:
			"files it holds to drop first, comma separated, by path or stored name",
	})
	.option("conversation", z.string(), {
		default: "",
		description:
			"conversation to keep the files with, when $SPLATES_CONVERSATION is not set",
	})
	.action(async (opts, ctx) =>
		ctx.journal.record(
			"attach",
			opts.task || (await here(ctx)),
			() =>
				attach(ctx, commaList(opts.files), ctx.ps.cwd(), {
					task: opts.task || undefined,
					remove: commaList(opts.remove),
					conversation: opts.conversation || undefined,
				}),
			(stored) => ({ stored, removed: commaList(opts.remove) }),
		),
	);

splates
	.command("retry")
	.use(repository({ needs: "own" }))
	.description(
		"give a task that spent its merge attempts another mergeRetryCount of them; the way out of `budget_exhausted` that is not remove and redo, for a person to run once they have seen the tree",
	)
	.arg("task", z.string(), { description: "task name" })
	.action((opts, ctx) => recordRetry(ctx, opts.task));

splates
	.command("progress")
	.use(repository({ needs: "own" }))
	.description(
		"show how a long task is going as a card on the conversation's page that updates in place, instead of a chat line per step. Name the card with <id> (a background command's id closes it when the command ends). Give the update as text, or pipe a command's output in and give `-` as the text to stream it: each line becomes the note, and a `NN%` in it sets the percent. The server publishes a card at most every two seconds and keeps only the newest of a burst, so report as often as is natural. Without `splates server` it only prints the card. The conversation is $SPLATES_CONVERSATION, or --conversation <id> from an agent outside `splates server`",
	)
	.arg("id", z.string(), { description: "the card's name" })
	.arg("text", z.string().optional(), {
		description: "the note; `-` reads lines from stdin as notes",
	})
	.option("title", z.string(), {
		default: "",
		description: "what the card is called; the id by default",
	})
	.option("percent", z.coerce.number().optional(), {
		description: "how far along, 0 to 100",
	})
	.option("done", z.boolean(), {
		default: false,
		description: "the task finished well",
	})
	.option("failed", z.boolean(), {
		default: false,
		description: "the task failed",
	})
	.option("conversation", z.string(), {
		default: "",
		description:
			"conversation id, when not run by an agent `splates server` started",
	})
	.action((opts, ctx) => runProgress(ctx, opts));

splates
	.mount("artifact", splatesArtifact)
	.mount("task", splatesTask)
	.mount("lane", splatesLane)
	.mount("board", splatesBoard)
	.mount("ship", splatesShip)
	.mount("projects", splatesProjects)
	.mount("creds", splatesCreds)
	.mount("tunnel", splatesTunnel)
	.mount("slots", splatesSlots)
	.mount("worker", splatesWorker)
	.mount("queue", splatesQueue)
	.mount("hook", splatesHook)
	.mount("replica", splatesReplica)
	.mount("evals", splatesEvals);
