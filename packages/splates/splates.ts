// scry-ignore-file compact-files: the root roster of top-level commands and their flags, each body handed to its own module and each group mounted from its own file

import { agents } from "@stringsync/splates-server/agents";
import { attach } from "@stringsync/splates-server/artifacts";
import { commaList } from "@stringsync/splates-server/comma-list";
import { exits, fail } from "@stringsync/splates-server/exit";
import { DEFAULT_COUNT, log as showLog } from "@stringsync/splates-server/log";
import { merge } from "@stringsync/splates-server/merge";
import { portsLs } from "@stringsync/splates-server/ports";
import { forget, init } from "@stringsync/splates-server/projects";
import type { Facts } from "@stringsync/splates-server/records";
import { repository } from "@stringsync/splates-server/records";
import type { SplatesDeps } from "@stringsync/splates-server/server";
import {
	newest,
	rosterOf,
	runHeavy,
	seeded,
	update,
} from "@stringsync/splates-server/server";
import { addFactTasks } from "@stringsync/splates-server/stats";
import {
	add,
	checkpoint,
	claim,
	DEFAULT_TIMEOUT,
	escalate,
	follow,
	handoff,
	list,
	path,
	REMOVE_REASONS,
	recordRetry,
	remove,
	reportToCaller,
	serveProject,
	show,
	tell,
	untilAfter,
	wait,
} from "@stringsync/splates-server/tasks";
import { cli } from "webappwiz/cmd";
import { Duration } from "webappwiz/time";
import { z } from "zod";
import { splatesArtifact } from "./artifact";
import { splatesBudget } from "./budget";
import { splatesCreds } from "./creds";
import { effortIn, here, offeredOf, taskIds } from "./flags";
import { splatesHook } from "./hook";
import { splatesLane } from "./lane";
import { splatesProjects } from "./projects";
import { splatesQueue } from "./queue";
import { splatesServer } from "./server";
import { setup } from "./setup";
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
	.command("update")
	.use(repository({ needs: "own" }))
	.description(
		"bring this repository up to the newest splates on npm: run `update` on that release when it is newer than this one, which installs its splates skill with `bunx skills add` over the copy there, leaving one that links to your own; commit what changed",
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
	.command("heavy")
	.description(
		"run a heavy command (a full test run, an install) in one of this machine's heavy-job slots, waiting for one to come free first, so agents testing at once queue rather than run out of memory; `SPLATES_HEAVY_JOBS` sets how many run at once, 2 by default",
	)
	.rest("command", z.string(), {
		description: "the command and its arguments, after `--`",
	})
	.action(async (opts, ctx) => {
		const code = await runHeavy(ctx, opts.command);
		if (code !== 0) {
			ctx.ps.exit(code);
		}
	});

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
	.option("task", z.string(), {
		default: "",
		description:
			"start these queued tasks by number, comma separated, the first as this one and the rest taken up by it: their words become the plan's Goal, merging removes them, and removing it puts them back in the queue",
	})
	.option("goal", z.string(), {
		default: "",
		description:
			"one or two lines on what done means, written under `## Goal` in the task's SPLATES.md; required unless --task seeds the Goal",
	})
	.option("agent", z.string(), {
		default: "",
		description:
			"hand the task to an agent on the roster (`splates agents`), which `splates server` starts in the worktree, told to claim it; the conversation you run this from stays where it is. Never for a part (--base task/<task>), which goes to your harness's own subagents",
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
	.action(async (opts, ctx) => {
		if (
			opts.agent === "" &&
			(opts.model !== "" || opts.effort !== "" || opts.prompt !== "")
		) {
			fail("usage", "--model, --effort and --prompt go with --agent", {
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
					};
		const agents = dispatch === undefined ? [] : await seeded(rosterOf(ctx));
		const all = await ctx.tasks.all();
		const subjects = taskIds(opts.task).flatMap(
			(id) => all.find((each) => each.id === id)?.subject ?? [],
		);
		await ctx.journal.record(
			"add",
			opts.slug,
			() =>
				add(ctx, opts.slug, {
					base: opts.base || undefined,
					tasks: taskIds(opts.task),
					goal: opts.goal.trim() || undefined,
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
		"resume an existing task: take ownership of its worktree and print its path, status and any half-finished rebase; an escalated task goes back to working; refuses while another agent holds the lease, but takes a stale one silently, so `splates show` first if the tree may not be abandoned",
	)
	.arg("task", z.string(), { description: "task name" })
	.action(async (opts, ctx) => {
		await ctx.journal.record(
			"claim",
			opts.task,
			() => claim(ctx, opts.task),
			(claimed) => claimed,
		);
		await follow(ctx, opts.task);
	});

splates
	.command("merge")
	.use(repository({ needs: "own" }))
	.description(
		"land this worktree's branch on its base (trunk unless created with --base): rebase onto it, run tests on the rebased code, fast-forward it in whichever worktree has it checked out, then discard the worktree, branch and record (linear history, never a merge commit, no flag to skip tests); requires committed work, refusing a dirty worktree",
	)
	.option("message", z.string(), {
		default: "",
		description:
			"squash the task's commits into one with this message before landing, saying what the base gains",
	})
	.action(async (opts, ctx) => {
		const task = await here(ctx);
		// Read before the merge discards the record that names its caller.
		const landing = task === null ? null : await ctx.service.find(task);
		// Filled by `merge` as it learns each; a refusal keeps what it had.
		const facts: Partial<Facts["merge"]> = {};
		await ctx.journal.record(
			"merge",
			task,
			() => merge(ctx, ctx.ps.cwd(), facts, { message: opts.message }),
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
		if (landing !== null) {
			await reportToCaller(ctx, landing);
		}
	});

splates
	.command("remove")
	.use(repository({ needs: "tasks" }))
	.description(
		"discard a task: worktree, branch and state file; cheap and encouraged, since redoing a task against current trunk often beats a hard rebase",
	)
	.arg("task", z.string(), { description: "task name" })
	.option("force", z.boolean(), {
		default: false,
		description: "discard even when another agent holds the lease",
	})
	.option("reason", z.optional(z.enum(REMOVE_REASONS)), {
		description:
			"why, for the Stats page: nothing (nothing to change), moot (no longer needed), superseded (done some other way), redo (better redone against current trunk)",
	})
	.action(async (opts, ctx) => {
		const removing = await ctx.service.find(opts.task);
		await ctx.journal.record(
			"remove",
			opts.task,
			() => remove(ctx, opts.task, { force: opts.force, reason: opts.reason }),
			({ released }) => ({ why: opts.reason ?? null, released }),
		);
		await follow(ctx, null, { from: opts.task });
		await reportToCaller(ctx, removing);
	});

splates
	.command("list")
	.use(repository({ needs: "read" }))
	.description(
		"list every started task: its number, name, status, lease (held: an agent is on it now; stale: gone quiet, normal for a task mid-edit; none), commits ahead of trunk, age; `splates task list` lists the queue",
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.option("files", z.boolean(), {
		default: false,
		description:
			"add each task's Goal and changed files (committed or not), to check for overlap before starting",
	})
	.action((opts, ctx) => list(ctx, { json: opts.json, files: opts.files }));

splates
	.command("show")
	.use(repository({ needs: "read" }))
	.description(
		"read one task without touching it: everything `list` shows for it, plus the SPLATES.md its agent left at the worktree root; takes no lease, so it cannot knock that agent off its own tree",
	)
	.arg("task", z.string(), { description: "task name" })
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => show(ctx, opts.task, { json: opts.json }));

splates
	.command("wait")
	.use(repository({ needs: "read" }))
	.description(
		"block until a task stops moving: escalated, or gone (merged or removed), or broken; takes no lease, and gives up with `timeout` rather than waiting forever",
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
		"show what has been done here recently: one line per add, claim, merge, remove, escalate, retry, queued task and more, with how it ended; outlives the tasks themselves",
	)
	.option("count", z.coerce.number(), {
		default: DEFAULT_COUNT,
		description: "how many entries to show",
	})
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => showLog(ctx, { count: opts.count, json: opts.json }));

splates.mount("server", splatesServer);

splates
	.command("ports")
	.description(
		"list the ports tasks serve, found by the running `splates server` as an editor finds ports to forward: each port a process in a task's worktree, or under its agent, listens on, with its link through the ports host `splates server --ports-host` saved, behind Cloudflare Access, and its link on this machine, which on a worker whose server runs elsewhere only that worker's own ports have; give the user both",
	)
	.arg("task", z.string(), {
		default: "",
		description: "only this task's ports; every task's by default",
	})
	.option("dev", z.string(), {
		default: "",
		description:
			"the `splates server` to ask, a URL such as http://localhost:4310; by default the one an agent runs under, from SPLATES_DEV, else the coordinator this machine's worker relays to, else this machine's on its default port",
	})
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) =>
		portsLs({
			task: opts.task,
			dev: opts.dev,
			json: opts.json,
			log: ctx.log,
			fs: ctx.fs,
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
	.action(async (opts, ctx) => {
		if (opts.step === "" && (opts.skip || opts.unskip)) {
			fail("usage", "--skip and --unskip name a step", {});
		}
		if (opts.skip && opts.unskip) {
			fail("usage", "--skip or --unskip, not both", { step: opts.step });
		}
		await setup(ctx, opts);
	});

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
	.command("escalate")
	.use(repository({ needs: "own" }))
	.description(
		"hand this task to a human and stop: records the reason, drops the lease and leaves the worktree exactly as it is; use instead of resolving a genuine conflict badly just to finish",
	)
	.arg("reason", z.string(), {
		description:
			"why this needs a human; with --review, what to look at before approving",
	})
	.option("task", z.string(), {
		default: "",
		description: "task name, when run outside its worktree",
	})
	.option("review", z.boolean(), {
		default: false,
		description:
			"ask a person to approve merging, the reason saying what to look at, approved in chat; refused until the task is ready to merge, with every question under ## Blocked and step under ## Next checked",
	})
	.action(async (opts, ctx) => {
		const task = opts.task || (await here(ctx));
		await ctx.journal.record(
			"escalate",
			task,
			() =>
				escalate(ctx, opts.reason, ctx.ps.cwd(), {
					task: opts.task || undefined,
					review: opts.review,
				}),
			(facts) => facts,
		);
		if (task !== null) {
			await reportToCaller(ctx, await ctx.service.find(task));
		}
	});

splates
	.command("tell")
	.use(repository({ needs: "tasks" }))
	.description(
		"say something in the conversation of the agent a task was handed to with `splates add --agent` as the user would: how an orchestrator wakes an agent that sits idle, stops it for a change of plans, or passes on what its lane taught it; only the conversation that handed the task out may",
	)
	.arg("task", z.string(), { description: "task name" })
	.arg("text", z.string(), { description: "what to say, as markdown" })
	.option("stop", z.boolean(), {
		default: false,
		description:
			"stop the turn the agent is running first, as the user's Stop does, then say text: for a change of plans",
	})
	.action((opts, ctx) =>
		ctx.journal.record(
			"tell",
			opts.task,
			() => tell(ctx, opts.task, opts.text, { stop: opts.stop }),
			(to) => ({ to }),
		),
	);

splates
	.command("handoff")
	.use(repository({ needs: "own" }))
	.description(
		"hand the task you are at work on to another agent on the roster (`splates agents`), which `splates server` starts in its worktree, told `[SPLATES HANDOFF <task>]` to claim it and carry on from its SPLATES.md; it answers to the user as you did, and this conversation leaves the task, though a lane's orchestrator that started you goes on hearing of it; refused for a task another conversation is at work on",
	)
	.arg("task", z.string(), { description: "task name" })
	.option("agent", z.string(), {
		description: "the agent on the roster to hand it to",
	})
	.option("model", z.string(), {
		default: "",
		description:
			"the model it works on, by its id or name on the roster (default: the agent's own)",
	})
	.option("effort", z.string(), {
		default: "",
		description:
			"the thinking level it works at, one the agent offers (default: the agent's own)",
	})
	.option("prompt", z.string(), {
		default: "",
		description:
			"what to tell the agent beyond taking the task over, such as why it is handed on",
	})
	.action(async (opts, ctx) => {
		const agents = await seeded(rosterOf(ctx));
		const effort = await effortIn(ctx, opts.agent, opts.effort, {
			task: opts.task,
		});
		await ctx.journal.record(
			"handoff",
			opts.task,
			() =>
				handoff(
					ctx,
					opts.task,
					{
						agent: opts.agent,
						...(opts.model === "" ? {} : { model: opts.model }),
						...effort,
						...(opts.prompt === "" ? {} : { prompt: opts.prompt }),
					},
					agents,
				),
			(picked) => ({
				agent: picked.agent,
				model: picked.model ?? null,
			}),
		);
		await follow(ctx, null, { from: opts.task });
	});

splates
	.command("attach")
	.use(repository({ needs: "own" }))
	.description(
		"store screenshots and recordings for this task's questions to show: prints the path each was stored at, under .git/splates, which the `splates server` page shows inline; from a conversation (its $SPLATES_CONVERSATION, or --conversation) they stay with it past the task, otherwise they go when the task merges or is removed, and a task holds at most attachmentCapacity bytes; with no files, lists what it holds. A file the user will come back for on its own is an artifact instead (`splates artifact add`)",
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
		"give an escalated task another mergeRetryCount merge attempts and put it back to working; the way out of `budget_exhausted` that is not remove and redo, and only from escalated, so a human has seen the tree first",
	)
	.arg("task", z.string(), { description: "task name" })
	.action((opts, ctx) => recordRetry(ctx, opts.task));

splates
	.mount("artifact", splatesArtifact)
	.mount("task", splatesTask)
	.mount("lane", splatesLane)
	.mount("projects", splatesProjects)
	.mount("creds", splatesCreds)
	.mount("tunnel", splatesTunnel)
	.mount("slots", splatesSlots)
	.mount("worker", splatesWorker)
	.mount("queue", splatesQueue)
	.mount("hook", splatesHook)
	.mount("budget", splatesBudget);
