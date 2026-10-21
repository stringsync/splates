import { splatesHome } from "@stringsync/splates-server/models";
import type { SplatesDeps } from "@stringsync/splates-server/server";
import {
	addWorker,
	drainWorker,
	FileLogger,
	listWorkers,
	removeWorker,
	setWorkerSlots,
	WORKER_JOIN,
	wakeWorker,
	workerJoin,
	workerRecipe,
	workerRun,
} from "@stringsync/splates-server/workers";
import { cli } from "webappwiz/cmd";
import { CompositeLogger } from "webappwiz/log";
import { z } from "zod";
import { splatesWaiting } from "./waiting";

/** `splates worker`, which the root cli mounts after `splates slots`. */
export const splatesWorker = cli<SplatesDeps>("worker").description(
	"the machines that run tasks for `splates server`: each dials out to it and runs what it is given, agents, terminals and the git and process reads around them, on its own machine",
);

splatesWorker
	.command("run")
	.description(
		"run a worker on this machine until stopped: it dials `splates server`, by default the one on this machine through a socket in ~/.splates only you may open, and dials again whenever the link drops, while what it runs carries on; it stops reading a process's output while the server is away too long, so nothing is lost. Once its agents have moved off it, a server on another build has it restart on that build, through `bunx @stringsync/splates@<build>`, as it does when it refuses this worker for another protocol; one that says no build has it exit `outdated`",
	)
	.option("server", z.string(), {
		default: "",
		description:
			"the `splates server` to dial: its URL, whose /api/workers it opens, or unix:<path>; by default this machine's",
	})
	.option("coordinator", z.string(), {
		default: "",
		description:
			"the old name for --server, still read for workers installed before it, and passed to a build older than it",
	})
	.option("slots", z.coerce.number().int().min(0), {
		default: 0,
		description:
			"how many tasks this worker takes at once; by default one for each core and 4 GB of memory it has, whichever is fewer, as a VM such as WSL2 sees them",
	})
	.option("id", z.string(), {
		default: "",
		description:
			"what the server knows this worker by, kept across restarts so it picks up where it was; by default the id it joined as, kept beside its key, else the machine's host name",
	})
	.option("join", z.string(), {
		default: "",
		description:
			"a join token from `splates worker add` on the server, spent to join it before dialing; the key it answers is kept in this machine's system store, or read from SPLATES_WORKER_KEY on one without",
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
			"say only what went wrong, not each time it joins or loses its server, as the worker `splates server` starts beside itself does; all of it still goes to worker.log in ~/.splates, the one before it kept as worker.log.1",
	})
	.action((opts, ctx) =>
		workerRun({
			coordinator: opts.server || opts.coordinator,
			slots: opts.slots,
			id: opts.id,
			join: opts.join || ctx.ps.env(WORKER_JOIN) || "",
			ephemeral: opts.ephemeral,
			keyFile: opts["key-file"],
			log: opts.quiet ? quietLog(ctx) : ctx.log,
			ps: ctx.ps,
			fs: ctx.fs,
		}),
	);

splatesWorker
	.command("join")
	.description(
		"spend a join token from `splates worker add` and keep the key it answers, as `splates worker run --join` does, then exit, for an installer that leaves running the worker to a service",
	)
	.option("server", z.string(), {
		default: "",
		description: "the `splates server` to join: its URL",
	})
	.option("coordinator", z.string(), {
		default: "",
		description: "the old name for --server",
	})
	.option("join", z.string(), {
		default: "",
		description:
			"the join token `splates worker add` printed there; by default read from SPLATES_WORKER_JOIN, which keeps it out of the process list other users of the machine can read",
	})
	.option("id", z.string(), {
		default: "",
		description:
			"what the server knows this worker by, kept beside its key so a change of host name leaves it the same; by default the machine's host name",
	})
	.option("key-file", z.boolean(), {
		default: false,
		description:
			"keep the key in ~/.splates/worker.env, which only this user may read, rather than the system store, for `splates worker run --key-file` to read",
	})
	.action((opts, ctx) =>
		workerJoin({
			coordinator: opts.server || opts.coordinator,
			join: opts.join || ctx.ps.env(WORKER_JOIN) || "",
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
	.command("wake")
	.description(
		"wake a worker asleep at home, a Windows PC that joined in WSL2: a worker awake on its network sends the Wake-on-LAN packet. Placement wakes one by itself when agents queue, before making a worker",
	)
	.arg("id", z.string(), {
		description: "the worker, as `splates worker list` names it",
	})
	.option("dev", z.string(), dev)
	.action((opts, ctx) =>
		wakeWorker({
			id: opts.id,
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

splatesWorker.mount("queue", splatesWaiting);

/**
 * What a quiet worker says: what went wrong on the terminal, and everything
 * in `worker.log` in the splates home, which is all a worker `splates
 * server` started leaves of how it joined and lost its server.
 */
function quietLog(ctx: SplatesDeps) {
	const file = new FileLogger(ctx.fs, `${splatesHome(ctx.ps)}/worker.log`);
	return new CompositeLogger([
		{ info: () => {}, error: (...said) => ctx.log.error(...said) },
		file,
	]);
}
