import { mkdir } from "node:fs/promises";
import { cliAdapter } from "./probe-adapters";
import { recordBudget, reserveBudget } from "./probe-budget-accounting";
import {
	checkPairedControls,
	saveBatch,
	saveExperiment,
} from "./probe-experiment";
import {
	type ProbeModule,
	type RunOptions,
	type StoredRun,
	type Target,
	validate,
} from "./probe-record";
import { runOne } from "./probe-run";

export type {
	Adapter,
	ProbeModule,
	RunContext,
	RunOptions,
	Seed,
	StoredRun,
	Target,
} from "./probe-record";
export {
	assessRun,
	configurationHash,
	hash,
	readRun,
	validate,
} from "./probe-record";

/** All combinations get an outcome, including those cancelled before they start. */
export async function runProbes(
	module: ProbeModule,
	targets: Target[],
	opts: RunOptions,
): Promise<StoredRun[]> {
	validate(module.probes);
	for (const count of [opts.parallel, opts.reps]) {
		if (!Number.isSafeInteger(count) || count < 1) {
			throw new Error("parallel and reps must be positive integers");
		}
	}
	const seedIds = module.seeds.map((seed) => `${seed.id}@${seed.version}`);
	if (new Set(seedIds).size !== seedIds.length) {
		throw new Error("duplicate seed handler");
	}
	if (!targets.length) {
		throw new Error("select at least one adapter/model");
	}
	const jobs = module.probes.flatMap((probe) =>
		(probe.execution.kind === "cli"
			? [{ adapter: cliAdapter, model: null }]
			: targets
		)
			.filter((target) => opts.include?.(probe, target) ?? true)
			.flatMap((target) =>
				Array.from({ length: opts.reps }, (_, repetition) => ({
					probe,
					target,
					repetition,
				})),
			),
	);
	const { allowances, reservationId } = await reserveBudget(jobs, opts);
	await mkdir(opts.directory, { recursive: true });
	await saveExperiment(module, jobs, opts, allowances, reservationId);
	await saveBatch(jobs, opts);
	const results: StoredRun[] = [];
	let index = 0;
	const batch = new AbortController();
	const signal = opts.signal
		? AbortSignal.any([opts.signal, batch.signal])
		: batch.signal;
	const worker = async () => {
		for (;;) {
			const jobIndex = index++;
			const job = jobs[jobIndex];
			if (!job) {
				return;
			}
			const stored = await runOne(job.probe, {
				...opts,
				signal,
				onLimit: () =>
					batch.abort("budget threshold reached; queued runs cancelled"),
				seed: module.seeds.find(
					(seed) =>
						seed.id === job.probe.seed.id &&
						seed.version === job.probe.seed.version,
				),
				target: job.target,
				repetition: job.repetition,
				allowance: allowances?.[jobIndex],
				reservationId,
			});
			if (opts.experiment) {
				await checkPairedControls(stored, results);
			}
			results.push(stored.value);
			if (
				opts.stopOnFailure &&
				["unsupported", "infrastructure-error", "bound", "fail"].includes(
					stored.value.result.status,
				)
			) {
				batch.abort("experiment stopped after unsuccessful cell");
			}
			opts.completed?.(stored.value, stored.path);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(opts.parallel, jobs.length) }, worker),
	);
	await recordBudget(results, reservationId, opts);
	return results;
}
