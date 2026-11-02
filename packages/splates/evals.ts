import { resolve } from "node:path";
import {
	EvalLoopStore,
	type InspectLog,
	inspectBatch,
	LoopRecovery,
	loopEventSchema,
	loopNext,
	writeImported,
} from "@splates/server/evals";
import { fail } from "@splates/server/exit";
import { repository } from "@splates/server/records";
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

// Payload files keep multiline diagnoses and frozen contracts out of shell quoting.
for (const name of ["start", "improve"]) {
	splatesEvals
		.command(name)
		.use(repository({ needs: "own" }))
		.description(
			"create a durable eval loop (same ID and input retries safely); records only, never starts a paid run",
		)
		.arg("id", z.string())
		.arg("file", z.string(), {
			description:
				"JSON: contract, revision, conversation, optional task; see docs/evals.md",
		})
		.action(async (opts, ctx) => {
			const loops = new EvalLoopStore(ctx.storage);
			const saved = await loops.start(
				opts.id,
				JSON.parse(await ctx.fs.read(resolve(ctx.ps.cwd(), opts.file))),
			);
			ctx.log.info(
				JSON.stringify({ ...saved, next: loopNext(saved) }, null, 2),
			);
		});
}

splatesEvals
	.command("show")
	.use(repository({ needs: "own" }))
	.description(
		"print the loop's state, version, links, evidence, event/round history and next action as JSON",
	)
	.arg("id", z.string())
	.action(async (opts, ctx) => {
		const loops = new EvalLoopStore(ctx.storage);
		const saved = await loops.show(opts.id);
		ctx.log.info(JSON.stringify({ ...saved, next: loopNext(saved) }, null, 2));
	});

const loopCommands = {
	request: { type: "start-batch" },
	record: { type: "finish-batch" },
	diagnose: { type: "diagnose" },
	propose: { type: "candidate-ready" },
	keep: { type: "decide", action: "keep" },
	revert: { type: "decide", action: "revert" },
	rebaseline: { type: "rebaseline" },
	stop: { type: "stop" },
} as const;
for (const [name, discriminator] of Object.entries(loopCommands)) {
	splatesEvals
		.command(name)
		.use(repository({ needs: "own" }))
		.description(
			"record a loop transition without running evals or changing code; see docs/evals.md for payloads",
		)
		.arg("id", z.string())
		.arg("file", z.string(), {
			description: "JSON event payload without type/action",
		})
		.option("version", z.coerce.number().int().nonnegative(), {
			description: "expected version from show",
		})
		.option("event", z.string(), {
			description: "stable event ID; request uses the run-request ID",
		})
		.option("task", z.string().optional(), {
			description: "link the code-change task",
		})
		.action(async (opts, ctx) => {
			const payload: unknown = JSON.parse(
				await ctx.fs.read(resolve(ctx.ps.cwd(), opts.file)),
			);
			if (
				typeof payload !== "object" ||
				payload === null ||
				Array.isArray(payload)
			) {
				fail("usage", "Expected a JSON object");
			}
			const event = loopEventSchema.parse({ ...payload, ...discriminator });
			const loops = new EvalLoopStore(ctx.storage);
			const saved = await loops.change(opts.id, {
				id: opts.event,
				expectedVersion: opts.version,
				event,
				task: opts.task,
			});
			ctx.log.info(
				JSON.stringify({ ...saved, next: loopNext(saved) }, null, 2),
			);
		});
}

splatesEvals
	.command("resume")
	.use(repository({ needs: "own" }))
	.description(
		"recover the current loop card, run links, full history and next action without starting work",
	)
	.arg("id", z.string())
	.action(async (opts, ctx) => {
		const recovery = new LoopRecovery(ctx.storage, ctx.machine, ctx.git.root);
		ctx.log.info(JSON.stringify(await recovery.show(opts.id), null, 2));
	});

splatesEvals
	.command("reconcile")
	.use(repository({ needs: "own" }))
	.description(
		"record existing finished launch evidence after a lost notice; never starts evals",
	)
	.arg("id", z.string())
	.action(async (opts, ctx) => {
		const recovery = new LoopRecovery(ctx.storage, ctx.machine, ctx.git.root);
		await recovery.reconcile(opts.id);
		ctx.log.info(JSON.stringify(await recovery.show(opts.id), null, 2));
	});
