import { join, resolve } from "node:path";
import {
	EvalAgentsStore,
	type InspectLog,
	inspectBatch,
	REMARKS_FILE,
	targetOf,
	writeImported,
} from "@splates/server/evals";
import { fail } from "@splates/server/exit";
import { splatesHome } from "@splates/server/models";
import type { SplatesDeps } from "@splates/server/server";
import { cli } from "core/cmd";
import { color } from "core/log";
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

splatesEvals
	.command("remarks")
	.description(
		"attach remarks on a batch to it, as Markdown from <file>: what failed and why, what held up, any special circumstance, replacing earlier remarks: the Evals page shows them on the batch's report and its run card, and they stay for anyone viewing the batch later",
	)
	.arg("batch-dir", z.string(), {
		description:
			"the batch's directory, inside the one evals.results names; its name is the batch's",
	})
	.arg("file", z.string(), { description: "the remarks, as Markdown" })
	.action(async (opts, ctx) => {
		const dir = resolve(ctx.ps.cwd(), opts["batch-dir"]);
		const file = resolve(ctx.ps.cwd(), opts.file);
		if (!(await ctx.fs.exists(join(dir, "batch.json")))) {
			fail("not_found", `no eval batch at ${dir}`, { dir });
		}
		if (!(await ctx.fs.exists(file))) {
			fail("not_found", `no file at ${file}`, { file });
		}
		await ctx.fs.write(join(dir, REMARKS_FILE), await ctx.fs.read(file));
		ctx.log.info(`${color.green("attached")} remarks to ${dir}`);
	});

splatesEvals
	.command("agents")
	.description(
		"print the saved eval agents, one `agent:model@effort` target per line: copy them verbatim into the `Agents:` line of a run evals card, and name no other",
	)
	.action(async (_opts, ctx) => {
		const store = new EvalAgentsStore(
			`${splatesHome(ctx.ps)}/eval-agents.json`,
			ctx.fs,
		);
		const agents = await store.agents();
		if (agents.length === 0) {
			ctx.log.info(
				"no eval agents are saved: leave the Agents: line out of the run card",
			);
			return;
		}
		for (const pick of agents) {
			ctx.log.info(targetOf(pick));
		}
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
