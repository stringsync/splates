import { splatesHome } from "@stringsync/splates-server/models";
import { repository } from "@stringsync/splates-server/records";
import type { SplatesDeps } from "@stringsync/splates-server/server";
import {
	askAgain,
	exportBundle,
	importBundle,
	parseBundle,
} from "@stringsync/splates-server/transfer";
import { cli } from "webappwiz/cmd";
import { z } from "zod";

/** `splates config`, which the root cli mounts after `splates budget`. */
export const splatesConfig = cli<SplatesDeps>("config").description(
	"move this project's setup to another machine or project as one JSON file: its hooks, tasks and lanes, plans, the records of ended tasks and conversations, and from splates's home the agent roster, Auto pick rules, the agent settings picked as defaults and the eval agents. Never the creds' values, which stay in this machine's secret stores: the export names each cred agents asked for, with how to get it, and the import requests those the new machine does not keep yet on its Creds page. Nor the journal, locks, leases, spend or the registry of projects, which belong to the machine",
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
		const bundle = await exportBundle(
			{
				fs: ctx.fs,
				storage: ctx.storage,
				home: splatesHome(ctx.ps),
			},
			await ctx.creds.requests(),
		);
		const text = `${JSON.stringify(bundle, null, "\t")}\n`;
		if (opts.file === "") {
			ctx.log.info(text);
			return;
		}
		await ctx.fs.write(opts.file, text);
		ctx.log.info(
			`exported ${Object.keys(bundle.project).length} project file(s) and ${Object.keys(bundle.machine).length} machine file(s) to ${opts.file}, with how to get ${bundle.creds.length} cred(s) but not their values`,
		);
	});

splatesConfig
	.command("import")
	.use(repository({ needs: "own" }))
	.description(
		"write an export file's contents into this project and splates's home, with `splates server` stopped, since it rewrites the settings it holds, and request on the Creds page each cred it names that this machine does not keep; a file that already exists with other contents stops the import, naming each, unless --force overwrites it",
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
				storage: ctx.storage,
				home: splatesHome(ctx.ps),
			},
			bundle,
			{ force: opts.force },
		);
		const asked = await askAgain(ctx.creds, bundle);
		ctx.log.info(
			asked.length === 0
				? `imported ${done.written.length} file(s)`
				: `imported ${done.written.length} file(s) and requested ${asked.length} cred(s) to fill on the Creds page: ${asked.join(", ")}`,
		);
	});
