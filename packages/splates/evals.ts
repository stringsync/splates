import { basename, dirname, join, resolve } from "node:path";
import {
	diagnosesOf,
	EvalAgentsStore,
	EvalLaunches,
	type EvalQuota,
	EvalStore,
	evalQuota,
	faultsOf,
	type InspectLog,
	inspectBatch,
	projectEvalCommands,
	REMARKS_FILE,
	targetOf,
	writeImported,
} from "@splates/server/evals";
import { fail } from "@splates/server/exit";
import { Limits, splatesHome } from "@splates/server/models";
import { repository } from "@splates/server/records";
import { rosterOf, type SplatesDeps } from "@splates/server/server";
import { FsStorage } from "@splates/server/storage";
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
		"attach the eval lead's remarks on a batch to it, as Markdown from <file>, replacing earlier remarks: what held up and any special circumstance, then a `Diagnosis:` list with one entry per distinct failure, `- <run>[, <run>...] <check>: <causes>` (causes from harness, judge, skill, eval; an agent's one-off slip takes none and is said in the Why) with indented `- Why:` (required), `- Did: Step <n> ...` (steps counted from 1) and `- Proposed remedy:` or `- Applied remedy:` lines, each one sentence; it refuses another cause, a longer line, or a run or check the batch does not have. Older remarks with a `Faults:` list of `- <run>: <layers>` still read. Eval cards show each failure with its diagnosis, the rest of the remarks go to the batch's report, and they stay for anyone viewing the batch later",
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
		const remarks = await ctx.fs.read(file);
		let problem: string | null;
		try {
			faultsOf(remarks);
			problem = await unknownIn(dir, diagnosesOf(remarks) ?? []);
		} catch (error) {
			problem = (error as Error).message;
		}
		if (problem !== null) {
			fail("usage", problem, { file });
		}
		await ctx.fs.write(join(dir, REMARKS_FILE), remarks);
		ctx.log.info(`${color.green("attached")} remarks to ${dir}`);
	});

splatesEvals
	.command("agents")
	.description(
		"print the saved eval agents, one `agent:model@effort` target per line: copy them verbatim into the `Agents:` line of a run evals card, and name no other; `--quota` adds the share of quota each has left, as its agent last reported it",
	)
	.option("quota", z.boolean(), {
		default: false,
		description:
			"after each target, its headroom (the share left in its longest window) and the share left in each window it draws from, with when that window resets",
	})
	.option("json", z.boolean(), {
		default: false,
		description:
			"with --quota: emit JSON objects with target, headroom and windows",
	})
	.action(async (opts, ctx) => {
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
		if (!opts.quota) {
			for (const pick of agents) {
				ctx.log.info(targetOf(pick));
			}
			return;
		}
		const home = splatesHome(ctx.ps);
		const limits = await new Limits(
			new FsStorage(home, ctx.fs).document("limits.json"),
		).all();
		const roster = await rosterOf(ctx).agents();
		const now = Date.now();
		const quotas = agents.map((pick) =>
			evalQuota(
				pick,
				roster.find((each) => each.id === pick.agent),
				limits[pick.agent] ?? [],
				now,
			),
		);
		if (opts.json) {
			ctx.log.info(JSON.stringify(quotas));
			return;
		}
		for (const quota of quotas) {
			ctx.log.info(quotaLine(quota));
		}
	});

splatesEvals
	.command("order")
	.use(repository({ needs: "read" }))
	.description(
		"list single eval scenarios in run order (highest priority first, then never run, then oldest last run), using the project's evals.list and saved run history",
	)
	.option("agent", z.string().optional(), {
		description: "scope last-run time to runs on this agent",
	})
	.option("json", z.boolean(), {
		default: false,
		description: "emit JSON objects with priority and lastRunAt",
	})
	.action(async (opts, ctx) => {
		const commands = projectEvalCommands(
			ctx.ps,
			ctx.git.root,
			ctx.config.evals,
		);
		if (commands === null) {
			fail("not_found", "this project names no evals in splates.config.ts", {});
		}
		if (commands.list === null) {
			fail(
				"not_found",
				"this project names no evals.list in splates.config.ts",
				{},
			);
		}
		const launches = new EvalLaunches(ctx.ps, ctx.machine);
		const scenarios = await launches.scenarios(commands);
		const ordered = await new EvalStore(commands.results).order(
			scenarios,
			opts.agent ?? null,
		);
		if (opts.json) {
			ctx.log.info(JSON.stringify(ordered));
			return;
		}
		for (const each of ordered) {
			ctx.log.info(each.id);
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

/** What a diagnosis names that the batch in `dir` lacks: a run, a run that did not fail, or a check its run does not have; null when nothing. */
async function unknownIn(
	dir: string,
	diagnoses: NonNullable<ReturnType<typeof diagnosesOf>>,
): Promise<string | null> {
	const store = new EvalStore(dirname(dir));
	const grid = await store.grid(basename(dir));
	if (grid === null) {
		return null;
	}
	const cells = new Map(
		grid.grid.flatMap((cell) =>
			cell.run === null
				? []
				: [[cell.run.id.slice(cell.run.id.lastIndexOf("#") + 1), cell.run]],
		),
	);
	for (const diagnosis of diagnoses) {
		for (const run of diagnosis.runs) {
			const found = cells.get(run);
			if (found === undefined) {
				return `${run} is no finished run of this batch: name runs as its results do, as run-017`;
			}
			if (found.status === "pass") {
				return `${run} passed: diagnose only runs that failed or errored`;
			}
			if (found.status !== "fail" || diagnosis.check === "judge") {
				continue;
			}
			const detail = await store.run(found.id).catch(() => null);
			const checks = detail?.checks.map((each) => each.id) ?? [];
			if (checks.length > 0 && !checks.includes(diagnosis.check)) {
				return `${run} has no check ${diagnosis.check}: name one of ${checks.join(", ")}, or judge`;
			}
		}
	}
	return null;
}

/** `claude:sonnet  41% left; five_hour 25% (resets 2026-11-25 14:40); seven_day 41% (resets 2026-11-28 20:00)` */
function quotaLine(quota: EvalQuota): string {
	if (quota.headroom === null && quota.windows.length === 0) {
		return `${quota.target}  quota unknown: its agent has not reported any`;
	}
	const percent = (share: number): string => `${Math.round(share * 100)}%`;
	const head =
		quota.headroom === null
			? "headroom unknown"
			: `${percent(quota.headroom)} left`;
	const windows = quota.windows.map(
		(each) =>
			`${each.window} ${percent(each.left)}${
				each.resets === null
					? ""
					: ` (resets ${each.resets.slice(0, 16).replace("T", " ")})`
			}`,
	);
	return [`${quota.target}  ${head}`, ...windows].join("; ");
}
