import { basename, resolve } from "node:path";
import { cli } from "webappwiz/cmd";
import { z } from "zod";
import type { ArborDeps } from "./arbor";
import { commaList, here } from "./arbor-flags";
import { addArtifact, listArtifacts, removeArtifact } from "./artifact";
import { conversationOf } from "./conversation-given";
import { fail } from "./exit";
import { repository } from "./repository";

/** `arbor artifact`, which the root cli mounts after `arbor attach`. */
export const arborArtifact = cli<ArborDeps>("artifact").description(
	"files your conversation made as its outputs, such as a screenshot, a recording or an HTML page: kept by name for the life of the conversation, whatever task it was made in, and shown on the `arbor dev` page. The conversation is $ARBOR_CONVERSATION, or --conversation <id> from an agent outside `arbor dev`",
);

const conversation = [
	"conversation",
	z.string(),
	{
		default: "",
		description:
			"conversation id, when not run by an agent `arbor dev` started",
	},
] as const;

arborArtifact
	.command("add")
	.use(repository({ needs: "own" }))
	.description(
		"keep files as artifacts of this conversation, each named for its basename, or by --name when there is one; adding a name the conversation holds makes its next version, every earlier one kept. Past the size limits it stops with `too_large`, changing nothing for that file",
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

arborArtifact
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

arborArtifact
	.command("list")
	.use(repository({ needs: "own" }))
	.description(
		"the artifacts this conversation lists, and their current version",
	)
	.option(...conversation)
	.action(async (opts, ctx) =>
		listArtifacts(ctx, await conversationOf(ctx.service, opts.conversation)),
	);

arborArtifact
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
