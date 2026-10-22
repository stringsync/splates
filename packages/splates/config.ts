import { splatesHome } from "@stringsync/splates-server/models";
import { repository } from "@stringsync/splates-server/records";
import type { SplatesDeps } from "@stringsync/splates-server/server";
import {
	exportBundle,
	importBundle,
	parseBundle,
} from "@stringsync/splates-server/transfer";
import { cli } from "webappwiz/cmd";
import { z } from "zod";

/** `splates config`, which the root cli mounts after `splates budget`. */
export const splatesConfig = cli<SplatesDeps>("config").description(
	"move this project's setup to another machine or project as one JSON file: its hooks, tasks, plans, finished-task records and conversations, and from splates's home the agent roster and Auto pick rules. Never the creds: `creds.json` and the values in the secret stores stay behind, so ask for those again on the new machine. Nor the journal, locks, leases, spend or the registry of projects, which belong to the machine",
);

splatesConfig
	.command("export")
	.use(repository({ needs: "own" }))
	.description(
		"write the export file, to the file named or to stdout, and name what it holds",
	)
	.arg("file", z.string(), {
		default: "",
		description: "where to write it; stdout when left off",
	})
	.action(async (opts, ctx) => {
		const bundle = await exportBundle({
			fs: ctx.fs,
			splatesDir: ctx.splatesDir,
			home: splatesHome(ctx.ps),
		});
		const text = `${JSON.stringify(bundle, null, "\t")}\n`;
		if (opts.file === "") {
			ctx.log.info(text);
			return;
		}
		await ctx.fs.write(opts.file, text);
		ctx.log.info(
			`exported ${Object.keys(bundle.project).length} project file(s) and ${Object.keys(bundle.machine).length} machine file(s) to ${opts.file}`,
		);
	});

splatesConfig
	.command("import")
	.use(repository({ needs: "own" }))
	.description(
		"write an export file's contents into this project and splates's home; a file that already exists with other contents stops the import, naming each, unless --force overwrites it",
	)
	.arg("file", z.string(), { description: "an export from `config export`" })
	.option("force", z.boolean(), {
		default: false,
		description: "overwrite files here that differ from the export",
	})
	.action(async (opts, ctx) => {
		const bundle = parseBundle(await ctx.fs.read(opts.file), opts.file);
		const done = await importBundle(
			{
				fs: ctx.fs,
				splatesDir: ctx.splatesDir,
				home: splatesHome(ctx.ps),
			},
			bundle,
			{ force: opts.force },
		);
		ctx.log.info(`imported ${done.written.length} file(s)`);
	});
