import { basename, resolve } from "node:path";
import {
	addArtifact,
	listArtifacts,
	removeArtifact,
} from "@stringsync/splates-server/artifact";
import { commaList } from "@stringsync/splates-server/comma-list";
import { conversationOf } from "@stringsync/splates-server/conversation-given";
import { fail } from "@stringsync/splates-server/exit";
import { repository } from "@stringsync/splates-server/repository";
import type { SplatesDeps } from "@stringsync/splates-server/runtime-deps";
import { cli } from "webappwiz/cmd";
import { z } from "zod";
import { here } from "./flags";

/** `splates artifact`, which the root cli mounts after `splates attach`. */
export const splatesArtifact = cli<SplatesDeps>("artifact").description(
	"files your conversation made as its outputs, such as a screenshot, a recording or an HTML page: kept by name for the life of the conversation, whatever task it was made in, and listed on the `splates server` page beside its thread. A file that shows a question, an assumption or a demo step is no artifact: `splates attach` it. The conversation is $SPLATES_CONVERSATION, or --conversation <id> from an agent outside `splates server`",
);

const conversation = [
	"conversation",
	z.string(),
	{
		default: "",
		description:
			"conversation id, when not run by an agent `splates server` started",
	},
] as const;

splatesArtifact
	.command("add")
	.use(repository({ needs: "own" }))
	.description(
		"keep files as artifacts of this conversation, each named for its basename, or by --name when there is one; adding a name the conversation holds makes its next version, earlier ones kept until cleanup takes them. Past the project's limit (artifactProjectCapacity), `splates server` first evicts the oldest bytes the project keeps: removed and replaced versions, then what archived conversations show, then what live ones do. Past the file or conversation limit (artifactFileCapacity, artifactConversationCapacity), or the project's when even that would not make room, it stops with `too_large`, changing nothing for that file",
	)
	.arg("files", z.string(), { description: "files to keep, comma separated" })
	.option("name", z.string(), {
		default: "",
		description: "the artifact's name; for one file only",
	})
	.option(...conversation)
	.action(async (opts, ctx) => {
		const paths = commaList(opts.files);
		if (paths.length === 0) {
			fail("usage", "name the files to keep: nothing was changed");
		}
		if (opts.name !== "" && paths.length > 1) {
			fail("usage", "--name names one file: nothing was changed");
		}
		const id = await conversationOf(ctx.service, opts.conversation);
		const files = await Promise.all(
			paths.map(async (given) => {
				const path = resolve(ctx.ps.cwd(), given);
				const bytes = await ctx.fs.readBytes(path).catch(() => null);
				if (bytes === null) {
					fail("usage", `cannot read ${path}: nothing was changed`, {
						file: path,
					});
				}
				return { name: opts.name || basename(path), bytes };
			}),
		);
		const task = await here(ctx);
		for (const file of files) {
			await ctx.journal.record(
				"artifact add",
				task,
				() => addArtifact(ctx, id, file),
				(added) => ({
					name: file.name,
					version: added.version,
					bytes: added.bytes,
				}),
			);
		}
	});

splatesArtifact
	.command("remove")
	.use(repository({ needs: "own" }))
	.description(
		"stop listing the artifact of that name, every version kept until cleanup takes them; adding the name again lists it again",
	)
	.arg("name", z.string(), { description: "the artifact's name" })
	.option(...conversation)
	.action(async (opts, ctx) => {
		const id = await conversationOf(ctx.service, opts.conversation);
		await ctx.journal.record(
			"artifact remove",
			await here(ctx),
			() => removeArtifact(ctx, id, opts.name),
			(version) => ({ name: opts.name, version }),
		);
	});

splatesArtifact
	.command("list")
	.use(repository({ needs: "own" }))
	.description(
		"the artifacts this conversation lists, and their current version",
	)
	.option(...conversation)
	.action(async (opts, ctx) =>
		listArtifacts(ctx, await conversationOf(ctx.service, opts.conversation)),
	);

splatesArtifact
	.command("show")
	.use(repository({ needs: "own" }))
	.description("every version of an artifact, and which is current")
	.arg("name", z.string(), { description: "the artifact's name" })
	.option(...conversation)
	.action(async (opts, ctx) =>
		listArtifacts(
			ctx,
			await conversationOf(ctx.service, opts.conversation),
			opts.name,
		),
	);
