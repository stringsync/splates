import type { SplatesDeps } from "@stringsync/splates-server/server";
import {
	addWorker,
	drainWorker,
	listWorkers,
	removeWorker,
	setWorkerSlots,
	workerJoin,
	workerRecipe,
	workerRun,
} from "@stringsync/splates-server/workers";
import { cli } from "webappwiz/cmd";
import { z } from "zod";

/** `splates worker`, which the root cli mounts after `splates slots`. */
export const splatesWorker = cli<SplatesDeps>("worker").description(
	"the machines that run tasks for `splates server`: each dials out to its coordinator and runs what it is given, agents, terminals and the git and process reads around them, on its own machine",
);

splatesWorker
	.command("run")
	.description(
		"run a worker on this machine until stopped: it dials the coordinator, by default the `splates server` on this machine through a socket in ~/.splates only you may open, and dials again whenever the link drops, while what it runs carries on; it stops reading a process's output while the coordinator is away too long, so nothing is lost. Once its agents have moved off it, a coordinator on another build has it restart on that build, through `bunx @stringsync/splates@<build>`, as it does when it refuses this worker for another protocol; one that says no build has it exit `outdated`",
	)
	.option("coordinator", z.string(), {
		default: "",
		description:
			"the coordinator to dial: a `splates server` URL, whose /api/workers it opens, or unix:<path>; by default this machine's",
	})
	.option("slots", z.coerce.number().int().min(0), {
		default: 0,
		description:
			"how many tasks this worker takes at once; by default one for each core and 4 GB of memory it has, whichever is fewer, as a VM such as WSL2 sees them",
	})
	.option("id", z.string(), {
		default: "",
		description:
			"what the coordinator knows this worker by, kept across restarts so it picks up where it was; by default the machine's host name",
	})
	.option("join", z.string(), {
		default: "",
		description:
			"a join token from `splates worker add` on the coordinator, spent to join it before dialing; the key it answers is kept in this machine's system store, or read from SPLATES_WORKER_KEY on one without",
	})
	.option("ephemeral", z.boolean(), {
		default: false,
		description:
			"keep the key --join answers in memory alone, for a machine destroyed rather than restarted, as one a worker provider makes",
	})
	.option("key-file", z.boolean(), {
		default: false,
		description:
			"keep the key --join answers in ~/.splates/worker.env, which only this user may read, rather than the system store, for a machine whose store is locked or missing at boot, as WSL's is with no one signed in; read it from there on each run after",
	})
	.option("quiet", z.boolean(), {
		default: false,
		description:
			"say only what went wrong, not each time it joins or loses its coordinator, as the worker `splates server` starts beside itself does",
	})
	.action((opts, ctx) =>
		workerRun({
			coordinator: opts.coordinator,
			slots: opts.slots,
			id: opts.id,
			join: opts.join,
			ephemeral: opts.ephemeral,
			keyFile: opts["key-file"],
			log: opts.quiet
				? { info: () => {}, error: (...said) => ctx.log.error(...said) }
				: ctx.log,
			ps: ctx.ps,
			fs: ctx.fs,
		}),
	);

splatesWorker
	.command("join")
	.description(
		"spend a join token from `splates worker add` and keep the key it answers, as `splates worker run --join` does, then exit, for an installer that leaves running the worker to a service",
	)
	.option("coordinator", z.string(), {
		description: "the coordinator to join: its `splates server` URL",
	})
	.option("join", z.string(), {
		description: "the join token `splates worker add` printed there",
	})
	.option("id", z.string(), {
		default: "",
		description:
			"what the coordinator knows this worker by; by default the machine's host name",
	})
	.option("key-file", z.boolean(), {
		default: false,
		description:
			"keep the key in ~/.splates/worker.env, which only this user may read, rather than the system store, for `splates worker run --key-file` to read",
	})
	.action((opts, ctx) =>
		workerJoin({
			coordinator: opts.coordinator,
			join: opts.join,
			id: opts.id,
			keyFile: opts["key-file"],
			log: ctx.log,
			ps: ctx.ps,
			fs: ctx.fs,
		}),
	);

splatesWorker
	.command("recipe")
	.description(
		"print the shell script, run as root on a fresh Debian or Ubuntu machine, that installs what a Linux worker needs: bun, git, the shared browser and this build of splates, for the user `splates`. It is what a provider's snapshot is built from, and what the Windows installer runs in WSL",
	)
	.action((_opts, ctx) => workerRecipe({ log: ctx.log }));

splatesWorker
	.command("list")
	.description(
		"list the workers the running `splates server` has: kind (local over its socket, registered otherwise), platform, build, protocol, slots used and total, health with when it was last heard, tasks and $/hour, then any it refused for speaking another protocol",
	)
	.option("dev", z.string(), {
		default: "",
		description:
			"the `splates server` to ask, a URL such as http://localhost:4310; by default the one an agent runs under, from SPLATES_DEV",
	})
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) =>
		listWorkers({
			dev: opts.dev,
			json: opts.json,
			log: ctx.log,
			ps: ctx.ps,
			send: ctx.fetch,
		}),
	);

const dev = {
	default: "",
	description:
		"the `splates server` to ask, a URL such as http://localhost:4310; by default the one an agent runs under, from SPLATES_DEV",
};

splatesWorker
	.command("add")
	.description(
		"add a worker to the running `splates server`: prints a join token, single use and good for 15 minutes, for `splates worker run --join <token>` on the machine to join, which gets a key of its own that `splates worker remove` revokes; with --local N, makes this machine's own worker run N agents at once and take new ones again, adding it back if it was removed; with --provider, has the `workerProvider` in splates.config.ts make one, booted from the snapshot splates builds for it, which joins on its own and whose machine `splates worker remove` destroys",
	)
	.option("local", z.coerce.number().int().min(0), {
		default: 0,
		description: "this machine's own worker, with this many slots",
	})
	.option("provider", z.boolean(), {
		default: false,
		description:
			"have the server's worker provider make the worker, of its cheapest type unless --type says",
	})
	.option("type", z.string(), {
		default: "",
		description:
			"the worker provider's type to make, as it names it; implies --provider",
	})
	.option("dev", z.string(), dev)
	.action((opts, ctx) =>
		addWorker({
			local: opts.local,
			provider: opts.provider,
			type: opts.type,
			dev: opts.dev,
			log: ctx.log,
			ps: ctx.ps,
			send: ctx.fetch,
		}),
	);

splatesWorker
	.command("drain")
	.description(
		"take no new agents on a worker, letting those on it run to their end, but for one asking you something in a task, which saves its task and lets its slot go, its question kept for you to answer and carry it on elsewhere; --undo takes new ones again",
	)
	.arg("id", z.string(), {
		description: "the worker, as `splates worker list` names it",
	})
	.option("undo", z.boolean(), {
		default: false,
		description: "take new agents again",
	})
	.option("dev", z.string(), dev)
	.action((opts, ctx) =>
		drainWorker({
			id: opts.id,
			undo: opts.undo,
			dev: opts.dev,
			log: ctx.log,
			ps: ctx.ps,
			send: ctx.fetch,
		}),
	);

splatesWorker
	.command("slots")
	.description(
		"set how many agents a worker runs at once, from now on, over what it started with",
	)
	.arg("id", z.string(), {
		description: "the worker, as `splates worker list` names it",
	})
	.arg("slots", z.coerce.number().int().min(1), {
		description: "how many at once",
	})
	.option("dev", z.string(), dev)
	.action((opts, ctx) =>
		setWorkerSlots({
			id: opts.id,
			slots: opts.slots,
			dev: opts.dev,
			log: ctx.log,
			ps: ctx.ps,
			send: ctx.fetch,
		}),
	);

splatesWorker
	.command("remove")
	.description(
		"remove a worker, revoking its key: one with agents on it drains and is removed once they end; --force ends them now, frees their slots, and places each again on another worker, to carry on its task from the checkpoint it last pushed. This machine's own worker, `local`, stops taking agents, its agents running to their end, and leaves this machine only coordinating until `splates worker add --local <slots>`; it takes no --force",
	)
	.arg("id", z.string(), {
		description: "the worker, as `splates worker list` names it",
	})
	.option("force", z.boolean(), {
		default: false,
		description: "end the agents on it now rather than wait for them",
	})
	.option("dev", z.string(), dev)
	.action((opts, ctx) =>
		removeWorker({
			id: opts.id,
			force: opts.force,
			dev: opts.dev,
			log: ctx.log,
			ps: ctx.ps,
			send: ctx.fetch,
		}),
	);
