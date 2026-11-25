import { basename } from "node:path";
import {
	blockerAdd,
	closesOnFrom,
	sinceNeedsSignal,
} from "@splates/server/board";
import { pickScope } from "@splates/server/config";
import { repository } from "@splates/server/records";
import type { SplatesDeps } from "@splates/server/server";
import { cli } from "core/cmd";
import { z } from "zod";
import { folderOf, here } from "./flags";

/** `splates blocker`, which the root cli mounts after `splates task`. */
export const splatesBlocker = cli<SplatesDeps>("blocker").description(
	"what stops the task you work on: add a task that has to merge first, and `splates merge` waits on it",
);

splatesBlocker
	.command("add")
	.use(repository({ needs: "queue" }))
	.description(
		"block this task on another: a task number, or a subject for a new Backlog task. The conversation goes on, `splates merge` refuses until every blocker has ended, and a notice comes when the last one does",
	)
	.arg("blocker", z.string(), {
		description: "a task number (`12`, `#12`), or the subject of a new task",
	})
	.option("closes-on", z.string(), {
		default: "",
		description:
			"with a subject: make the new task close on this signal (`<project>.<name>`) instead of being worked: nobody starts it, and it ends as if merged when the signal fires, which clears this task's blocker. Use it to wait on an outside fact before work can start",
	})
	.option("since", z.string(), {
		default: "",
		description:
			"with --closes-on: also take a firing from before now: how long ago (30m, 2h, 1d) or an ISO time",
	})
	.action(async (opts, ctx) => {
		sinceNeedsSignal(opts["closes-on"], opts.since);
		const from = await here(ctx);
		const folder = await folderOf(ctx);
		const scope = pickScope({
			config: ctx.config,
			repoName: basename(ctx.git.root),
			named: undefined,
			folder,
		});
		await blockerAdd(ctx, opts.blocker, {
			task: from,
			conversation: await ctx.service.conversation(),
			...(scope === null ? {} : { scope }),
			...(opts["closes-on"] === ""
				? {}
				: {
						closesOn: closesOnFrom(opts["closes-on"], opts.since, Date.now()),
					}),
		});
	});
