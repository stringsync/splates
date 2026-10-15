import { cli, type Deps } from "webappwiz/cmd";
import type { Fs } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { z } from "zod";
import { add } from "./add";
import { agents } from "./agents";
import { arborCreds } from "./arbor-creds";
import { serveDev } from "./arbor-dev";
import { commaList, here, rosterOf, seeded, todoIds } from "./arbor-flags";
import { arborLane } from "./arbor-lane";
import { arborTodo } from "./arbor-todo";
import { arborTunnel } from "./arbor-tunnel";
import { attach } from "./attach";
import { claim } from "./claim";
import type { SecretStores } from "./creds";
import { DEFAULT_PORT } from "./dev";
import type { Assets } from "./dev/assets";
import { escalate } from "./escalate";
import { exits, fail } from "./exit";
import { follow } from "./follow";
import { handoff } from "./handoff";
import { forget, init } from "./init";
import { list } from "./list";
import { DEFAULT_COUNT, log as showLog } from "./log";
import { merge } from "./merge";
import { path } from "./path";
import { newest } from "./release";
import { remove } from "./remove";
import { repository } from "./repository";
import { retry } from "./retry";
import { show } from "./show";
import { systems } from "./system";
import { reportToCaller, tell } from "./tell";
import { update } from "./update";
import { DEFAULT_TIMEOUT, wait } from "./wait";
import { REMOVE_REASONS } from "./worktree";

/** Everything `arbor` is run with, before the repository middleware adds to it. */
export interface ArborDeps extends Deps {
	fs: Fs;
	/** The built page `dev` serves as its preview. */
	assets: Assets;
	/** Where creds are kept; the system's stores by default. */
	secrets?: SecretStores;
	/** How `arbor tunnel setup` reaches Cloudflare's API; the global one by default. */
	fetch?: typeof fetch;
}

// Outermost first: a refusal raised in an action unwinds past `repository` and
// stops at `exits`, which is the only thing that ends the process.
export const arbor = cli<ArborDeps>("arbor").use(exits<ArborDeps>());

// Every action is handed the dependencies it runs with, so it passes the
// context straight on: each command takes the few it names off it.
arbor
	.command("init")
	.use(repository({ creates: true }))
	.description(
		"make this repository an arbor project: set up its records under .git/arbor when it has none, install the arbor skill of this release with `bunx skills add`, and register it in ~/.arbor/projects.json, so `arbor dev` serves it beside every other; run again, it changes only what is not so already",
	)
	.action((_opts, ctx) => init(ctx));

arbor
	.command("update")
	.use(repository())
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
	.command("forget")
	.use(repository())
	.description(
		"take this repository off ~/.arbor/projects.json, so `arbor dev` no longer offers it; its records stay, and `arbor init` brings it back",
	)
	.action((_opts, ctx) => forget(ctx));

arbor
	.command("add")
	.use(repository())
	.description(
		"start a new task: create branch task/<task>, a worktree at ../<repo>-arbor/<task> and a state record",
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
	.action(async (opts, ctx) => {
		if (opts.agent === "" && (opts.model !== "" || opts.prompt !== "")) {
			fail("usage", "--model and --prompt go with --agent", {
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
				agent: dispatch?.agent ?? null,
				model: dispatch?.model ?? null,
			},
		);
	});

arbor
	.command("claim")
	.use(repository())
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
	.use(repository())
	.description(
		"land this worktree's branch on its base (trunk unless created with --base): rebase onto it, run tests on the rebased code, fast-forward it in whichever worktree has it checked out, then discard the worktree, branch and record (linear history, never a merge commit, no flag to skip tests); requires committed work, refusing a dirty worktree",
	)
	.action(async (_opts, ctx) => {
		const task = await here(ctx);
		// Read before the merge discards the record that names its caller.
		const landing = task === null ? null : await ctx.service.find(task);
		await ctx.journal.record("merge", task, () => merge(ctx, ctx.ps.cwd()));
		if (task !== null) {
			await follow(ctx, null, { from: task });
		}
		if (landing !== null) {
			await reportToCaller(ctx, landing);
		}
	});

arbor
	.command("remove")
	.use(repository())
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
		await ctx.journal.record("remove", opts.task, () =>
			remove(ctx, opts.task, { force: opts.force, reason: opts.reason }),
		);
		await follow(ctx, null, { from: opts.task });
		await reportToCaller(ctx, removing);
	});

arbor
	.command("list")
	.use(repository())
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
	.use(repository())
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
	.use(repository())
	.description(
		"read one task without touching it: everything `list` shows for it, plus the ARBOR.md its agent left at the worktree root; takes no lease, so it cannot knock that agent off its own tree",
	)
	.arg("task", z.string(), { description: "task name" })
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => show(ctx, opts.task, { json: opts.json }));

arbor
	.command("wait")
	.use(repository())
	.description(
		"block until a task stops moving: escalated, or gone (merged or removed), or broken; takes no lease, and gives up with `timeout` rather than waiting forever",
	)
	.arg("task", z.string(), { description: "task name" })
	.option("timeout-secs", z.coerce.number(), {
		default: DEFAULT_TIMEOUT.secs,
		description: "how long to wait before giving up",
	})
	.action((opts, ctx) =>
		wait(ctx, opts.task, {
			timeout: Duration.secs(opts["timeout-secs"]),
		}),
	);

arbor
	.command("log")
	.use(repository())
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
	.use(repository({ migrates: true }))
	.description(
		"serve the todos and the tasks as a web page on this machine, where todos can be added, updated, reordered or removed",
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
			"the public host name of a tunnel to run, with cloudflared or the tunnel provider arbor.config.ts names, which is allowed as a host too; refused without --access-team and --access-aud, so a tunnel never exposes the page unauthenticated. With none of the tunnel and Access flags, the tunnel `arbor tunnel setup` saved runs, if any",
	})
	.option("tunnel-name", z.string(), {
		default: "",
		description:
			"the named tunnel cloudflared runs for --tunnel, by default the one its own config names; not with a tunnel provider of arbor.config.ts",
	})
	.option("slot", z.boolean(), {
		default: false,
		description:
			"serve this checkout's arbor at https://<word>.<zone>, a slot of its own on the zone `arbor tunnel setup` uses, behind the same Access policy, so several run side by side and a phone opens each by name: the checkout keeps its word, as fox, until it no longer exists. A slot keeps its own projects in ~/.arbor/slots/<word>, apart from yours, and starts in a throwaway project there unless that home registers the one it is run in; not with the tunnel and Access flags",
	})
	.action((opts, ctx) => serveDev(ctx, opts));

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
	.command("path")
	.use(repository())
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
	.use(repository())
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
		await ctx.journal.record("escalate", task, () =>
			escalate(ctx, opts.reason, ctx.ps.cwd(), {
				task: opts.task || undefined,
				review: opts.review,
			}),
		);
		if (task !== null) {
			await reportToCaller(ctx, await ctx.service.find(task));
		}
	});

arbor
	.command("tell")
	.use(repository())
	.description(
		"say something in the conversation of the agent a task was handed to with `arbor add --agent`, as the user would: how an orchestrator passes on the user's answers, a merge, or what its lane taught it, since the agent answers to it alone; only the conversation that handed the task out may",
	)
	.arg("task", z.string(), { description: "task name" })
	.arg("text", z.string(), { description: "what to say, as markdown" })
	.action((opts, ctx) =>
		ctx.journal.record(
			"tell",
			opts.task,
			() => tell(ctx, opts.task, opts.text),
			(to) => ({ to }),
		),
	);

arbor
	.command("handoff")
	.use(repository())
	.description(
		"hand the task you are at work on to another agent on the roster (`arbor agents`), which `arbor dev` starts in its worktree, told `[ARBOR HANDOFF <task>]` to claim it and carry on from its ARBOR.md; it answers to the user as you did, or with --relay to you, and this conversation leaves the task; refused to an agent an orchestrator handed its task to, and for a task another conversation is at work on",
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
			"for work you judged another model fits better: the agent answers to you, as to a lane's orchestrator, reporting back with `[ARBOR REPORT <task>]` and told what the user says with `arbor tell`; needs `arbor dev`",
	})
	.action(async (opts, ctx) => {
		const agents = await seeded(rosterOf(ctx));
		await ctx.journal.record("handoff", opts.task, () =>
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
		);
		await follow(ctx, null, { from: opts.task });
	});

arbor
	.command("attach")
	.use(repository())
	.description(
		"store screenshots and recordings for this task's questions to show: prints the path each was stored at, under .git/arbor, which the `arbor dev` page shows inline; they go when the task merges or is removed, and a task holds at most attachmentCapacity bytes; with no files, lists what it holds",
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
	.action(async (opts, ctx) =>
		ctx.journal.record("attach", opts.task || (await here(ctx)), () =>
			attach(ctx, commaList(opts.files), ctx.ps.cwd(), {
				task: opts.task || undefined,
				remove: commaList(opts.remove),
			}),
		),
	);

arbor
	.command("retry")
	.use(repository())
	.description(
		"give an escalated task another mergeRetryCount merge attempts and put it back to working; the way out of `budget_exhausted` that is not remove and redo, and only from escalated, so a human has seen the tree first",
	)
	.arg("task", z.string(), { description: "task name" })
	.action((opts, ctx) =>
		ctx.journal.record("retry", opts.task, () => retry(ctx, opts.task)),
	);

arbor
	.mount("todo", arborTodo)
	.mount("lane", arborLane)
	.mount("creds", arborCreds)
	.mount("tunnel", arborTunnel);
