import { loadConfig } from "@stringsync/splates-server/config";
import { Notes } from "@stringsync/splates-server/notes";
import type { Repository } from "@stringsync/splates-server/records";
import type { SplatesDeps } from "@stringsync/splates-server/server";

/** Prints the descriptions in this checkout, or the project explicitly named. */
export async function notes(ctx: SplatesDeps & Repository): Promise<void> {
	const root =
		ctx.project === undefined
			? (
					await ctx.git.run(ctx.ps.cwd(), "rev-parse", "--show-toplevel")
				).stdout.trim()
			: ctx.git.root;
	const config = await loadConfig(root, { fs: ctx.fs, git: ctx.git });
	const found = await new Notes(ctx.fs).list(root, config);
	for (const note of found) {
		ctx.log.info(note.description);
	}
}
