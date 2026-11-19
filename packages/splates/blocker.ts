import { basename } from "node:path";
import { blockerAdd } from "@splates/server/board";
import { pickScope, Tags } from "@splates/server/config";
import { refuseGroomer } from "@splates/server/conversations";
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
	.repeated("tag", z.string(), {
		description:
			"a tag for the new task a subject makes, comma separated or the flag repeated; a task number takes none",
	})
	.action(async (opts, ctx) => {
		await refuseGroomer(ctx.service, "blocker add");
		const from = await here(ctx);
		const tagging = new Tags(ctx.config);
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
			tags: tagging.forNew(
				tagging.parse(opts.tag),
				folder,
				!/^#?\d+$/.test(opts.blocker.trim()),
			),
		});
	});
