// scry-ignore-file compact-files: the root roster of top-level commands and their flags, each body handed to its own module and each group mounted from its own file
import { cli, type Deps } from "webappwiz/cmd";
import type { Fs } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { z } from "zod";
import { add } from "./add";
import { agents } from "./agents";
import { arborArtifact } from "./arbor-artifact";
import { arborCreds } from "./arbor-creds";
import { serveDev } from "./arbor-dev";
import { commaList, here, rosterOf, seeded, todoIds } from "./arbor-flags";
import { arborLane } from "./arbor-lane";
import { arborProjects } from "./arbor-projects";
import { setup } from "./arbor-setup";
import { arborSlots } from "./arbor-slots";
import { arborTodo } from "./arbor-todo";
import { arborTunnel } from "./arbor-tunnel";
import { arborWorker } from "./arbor-worker";
import { attach } from "./attach";
import { claim } from "./claim";
import type { SecretStores } from "./creds";
import { DEFAULT_PORT } from "./dev";
import type { Assets } from "./dev/assets";
import { escalate } from "./escalate";
import type { Facts } from "./events";
import { exits, fail } from "./exit";
import { addFactTodos } from "./fact-todos";
import { follow, serveProject } from "./follow";
import { handoff } from "./handoff";
import { runHeavy } from "./heavy-run";
import { forget, init } from "./init";
import { list } from "./list";
import { DEFAULT_COUNT, log as showLog } from "./log";
import { merge } from "./merge";
import { path } from "./path";
import { portsLs } from "./ports-list";
import { newest } from "./release";
import { remove } from "./remove";
import { repository } from "./repository";
import { recordRetry } from "./retry";
import { show } from "./show";
import { systems } from "./system";
import { reportToCaller, tell } from "./tell";
import { update } from "./update";
import { DEFAULT_TIMEOUT, untilAfter, wait } from "./wait";
import { REMOVE_REASONS } from "./worktree";

/** Everything `arbor` is run with, before the repository middleware adds to it. */
export interface ArborDeps extends Deps {
	fs: Fs;
	/**
	 * The registered project a leading `--project <slug>` names, which repo
	 * commands run on instead of the one the working directory is in.
	 */
	project?: string;
	/** The built page `dev` serves as its preview. */
	assets: Assets;
	/** Where creds are kept; the system's stores by default. */
	secrets?: SecretStores;
	/** How `arbor tunnel setup` reaches Cloudflare's API; the global one by default. */
	fetch?: typeof fetch;
}

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
export const arbor = cli<ArborDeps>("arbor").use(exits<ArborDeps>());

// Every action is handed the dependencies it runs with, so it passes the
// context straight on: each command takes the few it names off it.
arbor
	.command("init")
	.use(repository({ creates: true, needs: "own" }))
	.description(
		"make this repository an arbor project: set up its records under .git/arbor when it has none, install the arbor skill of this release with `bunx skills add`, and register it in ~/.arbor/projects.json, so `arbor dev` serves it beside every other; run again, it changes only what is not so already",
	)
	.action((_opts, ctx) => init(ctx));

arbor
	.command("update")
	.use(repository({ needs: "own" }))
	.description(
		"bring this repository up to the newest arbor on npm: run `update` on that release when it is newer than this one, which installs its arbor skill with `bunx skills add` over the copy there, leaving one that links to your own, and moves systems an older arbor.config.ts names into arbor.systems.ts; commit what changed",
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

arbor
	.command("heavy")
	.description(
		"run a heavy command (a full test run, an install) in one of this machine's heavy-job slots, waiting for one to come free first, so agents testing at once queue rather than run out of memory; `ARBOR_HEAVY_JOBS` sets how many run at once, 2 by default",
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

arbor
	.command("forget")
	.use(repository({ needs: "own" }))
	.description(
		"take this repository off ~/.arbor/projects.json, so `arbor dev` no longer offers it; its records stay, and `arbor init` brings it back",
	)
	.action((_opts, ctx) => forget(ctx));

arbor
	.command("add")
	.use(repository({ needs: "tasks" }))
	.description(
		"start a new task: create branch task/<task>, a worktree at ../<repo>-arbor.noindex/<task> and a state record",
	)
	.arg("task", z.string(), { description: "task name (lowercase-with-dashes)" })
	.option("base", z.string(), {
		default: "",
		description:
			"branch this task starts from and merges onto (default: trunk); `task/<other>` stacks this task on that one and lands the work in its worktree",
	})
	.option("todo", z.string(), {
		default: "",
		description:
			"take up these todos, comma separated: their words become the plan's Goal, merging removes them, and removing the task puts them back",
	})
	.option("goal", z.string(), {
		default: "",
		description:
			"one or two lines on what done means, written under `## Goal` in the task's ARBOR.md; required unless --todo seeds the Goal",
	})
	.option("agent", z.string(), {
		default: "",
		description:
			"hand the task to an agent on the roster (`arbor agents`), which `arbor dev` starts in the worktree, told to claim it; the conversation you run this from stays where it is",
	})
	.option("model", z.string(), {
		default: "",
		description:
			"with --agent: the model it works on, by its id or name on the roster (default: the agent's own)",
	})
	.option("prompt", z.string(), {
		default: "",
		description:
			"with --agent: what to tell the agent beyond claiming the task, such as a part's instructions",
	})
	.option("over-capacity", z.boolean(), {
		default: false,
		description:
			"with --agent: hand it out though you have as many tasks out to agents as agentsPerAgent (arbor.config.ts) allows; only when the person explicitly asked for more at once",
	})
	.action(async (opts, ctx) => {
		if (
			opts.agent === "" &&
			(opts.model !== "" || opts.prompt !== "" || opts["over-capacity"])
		) {
			fail("usage", "--model, --prompt and --over-capacity go with --agent", {
				task: opts.task,
			});
		}
		if (opts.goal.trim() === "" && opts.todo === "") {
			fail(
				"usage",
				`say what done means: \`arbor add ${opts.task} --goal "<one or two lines>"\`, or take todos with --todo`,
				{ task: opts.task },
			);
		}
		const dispatch =
			opts.agent === ""
				? undefined
				: {
						agent: opts.agent,
						...(opts.model === "" ? {} : { model: opts.model }),
						...(opts.prompt === "" ? {} : { prompt: opts.prompt }),
					};
		const agents = dispatch === undefined ? [] : await seeded(rosterOf(ctx));
		const all = await ctx.todos.all();
		const subjects = todoIds(opts.todo).flatMap(
			(id) => all.find((todo) => todo.id === id)?.subject ?? [],
		);
		await ctx.journal.record(
			"add",
			opts.task,
			() =>
				add(ctx, opts.task, {
					base: opts.base || undefined,
					todos: todoIds(opts.todo),
					goal: opts.goal.trim() || undefined,
					dispatch,
					agents,
					away: ctx.elsewhere !== null,
					overCapacity: opts["over-capacity"],
					// Before the task is live, or the page shows it a moment as an
					// external agent's. A task handed to another agent is that
					// agent's, so this conversation stays where it is.
					onTree:
						dispatch === undefined
							? () => follow(ctx, opts.task, { base: opts.base || undefined })
							: undefined,
				}),
			{
				base: opts.base || ctx.config.trunk,
				todos: todoIds(opts.todo),
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

arbor
	.command("claim")
	.use(repository({ needs: "own" }))
	.description(
		"resume an existing task: take ownership of its worktree and print its path, status and any half-finished rebase; an escalated task goes back to working; refuses while another agent holds the lease, but takes a stale one silently, so `arbor show` first if the tree may not be abandoned",
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

arbor
	.command("merge")
	.use(repository({ needs: "own" }))
	.description(
		"land this worktree's branch on its base (trunk unless created with --base): rebase onto it, run tests on the rebased code, fast-forward it in whichever worktree has it checked out, then discard the worktree, branch and record (linear history, never a merge commit, no flag to skip tests); requires committed work, refusing a dirty worktree",
	)
	.action(async (_opts, ctx) => {
		const task = await here(ctx);
		// Read before the merge discards the record that names its caller.
		const landing = task === null ? null : await ctx.service.find(task);
		// Filled by `merge` as it learns each; a refusal keeps what it had.
		const facts: Partial<Facts["merge"]> = {};
		await ctx.journal.record(
			"merge",
			task,
			() => merge(ctx, ctx.ps.cwd(), facts),
			facts as Facts["merge"],
		);
		if (task !== null) {
			// After the merge's own event, so the conversation says it landed
			// before what it found; landed is landed, whatever happens here.
			await addFactTodos(ctx, task).catch((error: unknown) =>
				ctx.log.error(`could not add todos for what the merge found: ${error}`),
			);
			await follow(ctx, null, { from: task });
		}
		if (landing !== null) {
			await reportToCaller(ctx, landing);
		}
	});

arbor
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

arbor
	.command("list")
	.use(repository({ needs: "read" }))
	.description(
		"list every task: name, status, lease (held: an agent is on it now; stale: gone quiet, normal for a task mid-edit; none), commits ahead of trunk, age",
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.option("files", z.boolean(), {
		default: false,
		description:
			"add each task's Goal and changed files (committed or not), to check for overlap before starting",
	})
	.action((opts, ctx) => list(ctx, { json: opts.json, files: opts.files }));

arbor
	.command("systems")
	.use(repository({ needs: "read" }))
	.description(
		"print the systems arbor.systems.ts names, the parts of the code each name stands for: every one, one by its name or an alias, or with --task those a task's changed files (committed or not) fall in; read from the current task's worktree, or --task's, so one named during a task counts at once",
	)
	.arg("name", z.optional(z.string()), {
		description: "a system to print alone, by its name or an alias",
	})
	.option("task", z.optional(z.string()), {
		description: "print only the systems this task touches",
	})
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action(async (opts, ctx) =>
		systems(ctx, {
			name: opts.name,
			task: opts.task,
			here: await here(ctx),
			json: opts.json,
		}),
	);

arbor
	.command("show")
	.use(repository({ needs: "read" }))
	.description(
		"read one task without touching it: everything `list` shows for it, plus the ARBOR.md its agent left at the worktree root; takes no lease, so it cannot knock that agent off its own tree",
	)
	.arg("task", z.string(), { description: "task name" })
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => show(ctx, opts.task, { json: opts.json }));

arbor
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

arbor
	.command("log")
	.use(repository({ needs: "read" }))
	.description(
		"show what has been done here recently: one line per add, claim, merge, remove, escalate, retry, todo and more, with how it ended; outlives the tasks themselves",
	)
	.option("count", z.coerce.number(), {
		default: DEFAULT_COUNT,
		description: "how many entries to show",
	})
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => showLog(ctx, { count: opts.count, json: opts.json }));

arbor
	.command("dev")
	.description(
		"serve every arbor project on this machine as a web page, from wherever it is run: the page picks the project it shows, adds one by its path, running `arbor init` there, and shows its todos and tasks, where todos can be added, updated, reordered or removed; it brings each project's records forward as it opens it",
	)
	.option("port", z.coerce.number(), {
		default: DEFAULT_PORT,
		description: "port to listen on, or the next open one above it",
	})
	.option("allow-hosts", z.string(), {
		default: "",
		description:
			"comma-separated host names the page may also be reached by, like a tunnel's; put Cloudflare Access in front of them with --access-team and --access-aud",
	})
	.option("access-team", z.string(), {
		default: "",
		description:
			"the Cloudflare Access team in front of --allow-hosts, as in <team>.cloudflareaccess.com; with --access-aud, those hosts answer only to a verified Access token, and may then use conversations and terminals",
	})
	.option("access-aud", z.string(), {
		default: "",
		description: "the AUD tag of that Access application",
	})
	.option("tunnel", z.string(), {
		default: "",
		description:
			"the public host name of a tunnel to run, with cloudflared or the tunnel provider named by arbor.config.ts in the repository it is run in, if any, which is allowed as a host too; refused without --access-team and --access-aud, so a tunnel never exposes the page unauthenticated. With none of the tunnel and Access flags, the tunnel `arbor tunnel setup` saved runs, if any",
	})
	.option("tunnel-name", z.string(), {
		default: "",
		description:
			"the named tunnel cloudflared runs for --tunnel, by default the one its own config names; not with a tunnel provider of arbor.config.ts",
	})
	.option("ports-host", z.string(), {
		default: "",
		description:
			"the wildcard base host to serve task ports under, saved for this machine so a bare `arbor dev` serves it too: each port a task's processes listen on opens at https://<task>-<port>.<base>, to whoever Cloudflare Access lets in, and is refused without Access; routing *.<base> here, its DNS and TLS, are yours. `none` forgets it, leaving each task port forwarded to a port on this machine's loopback alone",
	})
	.option("slot", z.boolean(), {
		default: false,
		description:
			"serve this checkout's arbor at https://<word>.<zone>, a slot of its own on the zone `arbor tunnel setup` uses, behind the same Access policy, so several run side by side and a phone opens each by name: a task's worktree keeps its word, as fox, until the task merges or is removed, which stops its server; run again, it stops the tree's last server first. Refused in an arbor repository's main tree, which every agent shares. A slot keeps its own projects in ~/.arbor/slots/<word>, apart from yours, starting with a throwaway project there; not with the tunnel and Access flags",
	})
	.action((opts, ctx) => serveDev(ctx, opts));

arbor
	.command("ports")
	.description(
		"list the ports tasks serve, found by the running `arbor dev` as an editor finds ports to forward: each port a process in a task's worktree, or under its agent, listens on, with its link through the ports host `arbor dev --ports-host` saved, behind Cloudflare Access, and its link on this machine; give the user both",
	)
	.arg("task", z.string(), {
		default: "",
		description: "only this task's ports; every task's by default",
	})
	.option("dev", z.string(), {
		default: "",
		description:
			"the `arbor dev` to ask, a URL such as http://localhost:4310; by default the one an agent runs under, from ARBOR_DEV, else this machine's on its default port",
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

arbor
	.command("agents")
	.description(
		"print the roster of agents arbor can start, kept for every project in ~/.arbor/agents.json: each agent's launch command and models, with what each model is good at and what it costs, for choosing whom to delegate to; writes the defaults (Claude, Codex) there first when there is none, and `arbor dev` starts conversations with those it lists",
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) =>
		agents({ roster: rosterOf(ctx), log: ctx.log }, { json: opts.json }),
	);

arbor
	.command("setup")
	.description(
		"set arbor up on this machine, one step at a time: with no step, each area's steps, checked from real state, and the one to do next; with a step, why it matters, the one thing the user does and what the agent does. Skips are kept in ~/.arbor/setup.json, so a skipped step stops asking",
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

arbor
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

arbor
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

arbor
	.command("tell")
	.use(repository({ needs: "tasks" }))
	.description(
		"say something in the conversation of the agent a task was handed to with `arbor add --agent` or `arbor handoff --relay`, as the user would: how an orchestrator wakes an agent that sits idle, stops it for a change of plans, or passes on what its lane taught it, and how a relaying agent passes on the user's answers; only the conversation that handed the task out may",
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

arbor
	.command("handoff")
	.use(repository({ needs: "own" }))
	.description(
		"hand the task you are at work on to another agent on the roster (`arbor agents`), which `arbor dev` starts in its worktree, told `[ARBOR HANDOFF <task>]` to claim it and carry on from its ARBOR.md; it answers to the user as you did, or with --relay to you, and this conversation leaves the task, though a lane's orchestrator that started you goes on hearing of it; refused to an agent that answers to another conversation, and for a task another conversation is at work on",
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
	.option("prompt", z.string(), {
		default: "",
		description:
			"what to tell the agent beyond taking the task over, such as why it is handed on",
	})
	.option("relay", z.boolean(), {
		default: false,
		description:
			"for work you judged another model fits better: the agent answers to you rather than the user, reporting back with `[ARBOR REPORT <task>]` and told what the user says with `arbor tell`; needs `arbor dev`",
	})
	.action(async (opts, ctx) => {
		const agents = await seeded(rosterOf(ctx));
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
						...(opts.prompt === "" ? {} : { prompt: opts.prompt }),
					},
					agents,
					{ relay: opts.relay },
				),
			(picked) => ({
				agent: picked.agent,
				model: picked.model ?? null,
				relay: opts.relay,
			}),
		);
		await follow(ctx, null, { from: opts.task });
	});

arbor
	.command("attach")
	.use(repository({ needs: "own" }))
	.description(
		"store screenshots and recordings for this task's questions to show: prints the path each was stored at, under .git/arbor, which the `arbor dev` page shows inline; from a conversation (its $ARBOR_CONVERSATION, or --conversation) they stay with it past the task, otherwise they go when the task merges or is removed, and a task holds at most attachmentCapacity bytes; with no files, lists what it holds",
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
			"conversation to keep the files with, when $ARBOR_CONVERSATION is not set",
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

arbor
	.command("retry")
	.use(repository({ needs: "own" }))
	.description(
		"give an escalated task another mergeRetryCount merge attempts and put it back to working; the way out of `budget_exhausted` that is not remove and redo, and only from escalated, so a human has seen the tree first",
	)
	.arg("task", z.string(), { description: "task name" })
	.action((opts, ctx) => recordRetry(ctx, opts.task));

arbor
	.mount("artifact", arborArtifact)
	.mount("todo", arborTodo)
	.mount("lane", arborLane)
	.mount("projects", arborProjects)
	.mount("creds", arborCreds)
	.mount("tunnel", arborTunnel)
	.mount("slots", arborSlots)
	.mount("worker", arborWorker);
