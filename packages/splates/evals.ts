import { resolve } from "node:path";
import {
	type InspectLog,
	inspectBatch,
	writeImported,
} from "@stringsync/splates-server/evals";
import { fail } from "@stringsync/splates-server/exit";
import type { SplatesDeps } from "@stringsync/splates-server/server";
import { cli } from "webappwiz/cmd";
import { color } from "webappwiz/log";
import { z } from "zod";

/** `splates evals`, which the root cli mounts after `splates replica`. */
export const splatesEvals = cli<SplatesDeps>("evals").description(
	"a project's evals from another framework, which the Evals page of `splates server` shows once they are a splates-evals/1 batch in the directory `evals.results` in splates.config.ts names (docs/evals.md)",
);

splatesEvals
	.command("import")
	.description(
		"turn a framework's results into a splates-evals/1 batch in <batch-dir>, replacing one there: for inspect, an Inspect AI eval log, `.json` read as it is and `.eval` through `inspect log dump`, a cell per sample and epoch that passes when every scorer's value, read as Inspect does (C 1, P 0.5, I 0), reaches --pass-at",
	)
	.arg("framework", z.enum(["inspect"]), {
		description: "what wrote the results: inspect",
	})
	.arg("file", z.string(), { description: "the framework's results file" })
	.arg("batch-dir", z.string(), {
		description:
			"the batch's directory, inside the one evals.results names; its name is the batch's",
	})
	.option("pass-at", z.coerce.number(), {
		default: 1,
		description: "the value, from 0 to 1, each scorer must reach for a pass",
	})
	.action(async (opts, ctx) => {
		const file = resolve(ctx.ps.cwd(), opts.file);
		const dir = resolve(ctx.ps.cwd(), opts["batch-dir"]);
		if (!(await ctx.fs.exists(file))) {
			fail("not_found", `no file at ${file}`, { file });
		}
		const imported = inspectBatch(await inspectLog(ctx, file), opts["pass-at"]);
		await writeImported(dir, imported);
		ctx.log.info(
			`${color.green("imported")} ${imported.batch.cells.length} cells to ${dir}`,
		);
	});

/** The log at `file`, dumped as JSON by Inspect's own CLI when it is a zipped `.eval`. */
async function inspectLog(ctx: SplatesDeps, file: string): Promise<InspectLog> {
	const text = file.endsWith(".eval")
		? await dumped(ctx, file)
		: await ctx.fs.read(file);
	try {
		const log = JSON.parse(text) as InspectLog;
		if (typeof log.eval?.task === "string") {
			return log;
		}
	} catch {}
	return fail("usage", `${file} is no Inspect eval log`, { file });
}

async function dumped(ctx: SplatesDeps, file: string): Promise<string> {
	const { exitCode, stdout, stderr } = await ctx.ps
		.spawnCapture(["inspect", "log", "dump", file])
		.catch(() =>
			fail(
				"usage",
				"`inspect` is not on PATH: activate the environment Inspect is installed in, or pass a log written with --log-format json",
			),
		);
	if (exitCode !== 0) {
		fail("usage", `inspect log dump ${file} failed: ${stderr.trim()}`, {
			file,
		});
	}
	return stdout;
}
