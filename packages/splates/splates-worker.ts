import { cli } from "webappwiz/cmd";
import { z } from "zod";
import type { SplatesDeps } from "./splates";
import { listWorkers } from "./worker-list";
import { workerRun } from "./worker-run";

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
