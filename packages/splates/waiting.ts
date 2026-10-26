import type { SplatesDeps } from "@stringsync/splates-server/server";
import { listQueue, moveQueued } from "@stringsync/splates-server/workers";
import { cli } from "webappwiz/cmd";
import { z } from "zod";

const DEV = {
	default: "",
	description:
		"the `splates server` to ask, a URL such as http://localhost:4310; by default the one an agent runs under, from SPLATES_DEV",
};

/** `splates worker queue`, which `splates worker` mounts. */
export const splatesWaiting = cli<SplatesDeps>("queue").description(
	"the agents waiting to start on a worker of the running `splates server`: nothing caps how many agents run, so one waits only while what splates starts on its own (the queue, automations, hooks, the groomer) is paused, or while no worker it can run on is up, first come, first served; none is ever failed for waiting. An agent you start waits only while no worker is up",
);

splatesWaiting
	.command("list")
	.description(
		"list the agents waiting to start, first in line first: position, project, task, conversation, how long each has waited and why (paused, no worker up, or worker draining)",
	)
	.option("dev", z.string(), DEV)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) =>
		listQueue({
			dev: opts.dev,
			json: opts.json,
			log: ctx.log,
			fs: ctx.fs,
			ps: ctx.ps,
			send: ctx.fetch,
		}),
	);

splatesWaiting
	.command("move")
	.description(
		"move an agent waiting to start to another place in line, from 1 for the next to start, then list the queue",
	)
	.arg("which", z.string(), {
		description: "the task it works, or its conversation's id",
	})
	.arg("position", z.coerce.number().int(), {
		description: "where in line to put it, from 1",
	})
	.option("dev", z.string(), DEV)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) =>
		moveQueued({
			which: opts.which,
			position: opts.position,
			dev: opts.dev,
			json: opts.json,
			log: ctx.log,
			fs: ctx.fs,
			ps: ctx.ps,
			send: ctx.fetch,
		}),
	);
