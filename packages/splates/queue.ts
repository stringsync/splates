import { listQueue, moveQueued } from "@stringsync/splates-server/queue-list";
import type { SplatesDeps } from "@stringsync/splates-server/runtime-deps";
import { cli } from "webappwiz/cmd";
import { z } from "zod";

const DEV = {
	default: "",
	description:
		"the `splates server` to ask, a URL such as http://localhost:4310; by default the one an agent runs under, from SPLATES_DEV",
};

/** `splates queue`, which the root cli mounts beside `splates worker`. */
export const splatesQueue = cli<SplatesDeps>("queue").description(
	"the agents waiting for a slot on a worker of the running `splates server`: each one another agent started (with `splates add --agent`, or a lane's orchestrator handing out todos), started or resumed while every worker it can run on is full, waits here, first come, first served, and starts once a slot frees, as when an agent left idle 30 minutes stops; none is ever failed for waiting. An agent you start waits only while no worker it can run on is up, as with this machine's own removed or none on the platform its project requires",
);

splatesQueue
	.command("list")
	.description(
		"list the agents waiting for a slot, first in line first: position, project, task, conversation, how long each has waited and why (no free slot, no worker up, or a platform no worker runs, as `needs macOS`)",
	)
	.option("dev", z.string(), DEV)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) =>
		listQueue({
			dev: opts.dev,
			json: opts.json,
			log: ctx.log,
			ps: ctx.ps,
			send: ctx.fetch,
		}),
	);

splatesQueue
	.command("move")
	.description(
		"move an agent waiting for a slot to another place in line, from 1 for the next to start, then list the queue",
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
			ps: ctx.ps,
			send: ctx.fetch,
		}),
	);
