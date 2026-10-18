import type { SplatesDeps } from "@stringsync/splates-server/runtime-deps";
import {
	addWorker,
	drainWorker,
	listWorkers,
	removeWorker,
	setWorkerSlots,
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
		"run a worker on this machine until stopped: it dials the coordinator, by default the `splates server` on this machine through a socket in ~/.splates only you may open, and dials again whenever the link drops, while what it runs carries on; it stops reading a process's output while the coordinator is away too long, so nothing is lost. Exits `outdated` when the coordinator speaks another protocol",
	)
	.option("coordinator", z.string(), {
		default: "",
		description:
			"the coordinator to dial: a `splates server` URL, whose /api/workers it opens, or unix:<path>; by default this machine's",
	})
	.option("slots", z.coerce.number().int().min(1), {
		default: 8,
		description: "how many tasks this worker takes at once",
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
			log: opts.quiet
				? { info: () => {}, error: (...said) => ctx.log.error(...said) }
				: ctx.log,
			ps: ctx.ps,
			fs: ctx.fs,
		}),
	);

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
		"add a worker to the running `splates server`: prints a join token, single use and good for 15 minutes, for `splates worker run --join <token>` on the machine to join, which gets a key of its own that `splates worker remove` revokes; with --local N, makes this machine's own worker run N agents at once and take new ones again",
	)
	.option("local", z.coerce.number().int().min(0), {
		default: 0,
		description: "this machine's own worker, with this many slots",
	})
	.option("dev", z.string(), dev)
	.action((opts, ctx) =>
		addWorker({
			local: opts.local,
			dev: opts.dev,
			log: ctx.log,
			ps: ctx.ps,
			send: ctx.fetch,
		}),
	);

splatesWorker
	.command("drain")
	.description(
		"take no new agents on a worker, letting those on it run to their end; --undo takes new ones again",
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
		"remove a worker, revoking its key: one with agents on it drains and is removed once they end; --force ends them now and frees their slots. This machine's own worker cannot be removed yet: drain it",
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
