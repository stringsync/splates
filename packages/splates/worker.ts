import { splatesHome } from "@stringsync/splates-server/models";
import type { SplatesDeps } from "@stringsync/splates-server/server";
import {
	drainWorker,
	FileLogger,
	listWorkers,
	removeWorker,
	workerRun,
} from "@stringsync/splates-server/workers";
import { cli } from "webappwiz/cmd";
import { CompositeLogger } from "webappwiz/log";
import { z } from "zod";
import { splatesWaiting } from "./waiting";

/** `splates worker`, which the root cli mounts after `splates slots`. */
export const splatesWorker = cli<SplatesDeps>("worker").description(
	"this machine’s worker, which runs agents, terminals and process reads for `splates server` over its Unix socket",
);

splatesWorker
	.command("run")
	.description(
		"run this machine’s worker until stopped, connecting over its private Unix socket and reconnecting when the server restarts",
	)
	.option("server", z.string(), {
		default: "",
		description:
			"the `splates server` to dial: unix:<path>; by default this machine's",
	})
	.option("coordinator", z.string(), {
		default: "",
		description:
			"the old name for --server, still read for workers installed before it, and passed to a build older than it",
	})
	.option("slots", z.coerce.number().int().min(0), {
		default: 0,
		description:
			"ignored: nothing caps how many agents a worker runs; still read, since a `splates server` started before it was dropped passes it",
	})
	.option("id", z.literal("local"), {
		default: "local",
		description:
			"what the server knows this worker by, kept across restarts so it picks up where it was; by default local",
	})
	.option("quiet", z.boolean(), {
		default: false,
		description:
			"say only what went wrong, not each time it joins or loses its server, as the worker `splates server` starts beside itself does; all of it still goes to worker.log in ~/.splates, the one before it kept as worker.log.1",
	})
	.action((opts, ctx) =>
		workerRun({
			coordinator: opts.server || opts.coordinator,
			id: opts.id,
			log: opts.quiet ? quietLog(ctx) : ctx.log,
			ps: ctx.ps,
			fs: ctx.fs,
		}),
	);

splatesWorker
	.command("list")
	.description(
		"list the workers the running `splates server` has: platform, build, protocol, health with when it was last heard, and tasks, then any it refused for speaking another protocol",
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
			fs: ctx.fs,
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
			fs: ctx.fs,
			ps: ctx.ps,
			send: ctx.fetch,
		}),
	);

splatesWorker
	.command("remove")
	.description(
		"stop this machine’s worker taking agents, letting its agents run to their end; resume it with `splates worker drain local --undo`",
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
			fs: ctx.fs,
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
