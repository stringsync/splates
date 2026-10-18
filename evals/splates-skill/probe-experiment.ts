import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Probe } from "./probe";
import type { Allowance } from "./probe-affordability";
import { pairedDifferences } from "./probe-pair";
import {
	assessRun,
	hash,
	type ProbeModule,
	type RunOptions,
	type StoredRun,
	saveResult,
	type Target,
} from "./probe-record";

/** Retain the entire planned matrix, including cells later cancelled before startup. */
export async function saveExperiment(
	module: ProbeModule,
	jobs: { probe: Probe; target: Target; repetition: number }[],
	opts: RunOptions,
	allowances: (Readonly<Allowance> | undefined)[] | undefined,
	reservationId?: string,
): Promise<void> {
	if (!opts.experiment) {
		return;
	}
	await writeFile(
		join(opts.directory, "experiment.json"),
		JSON.stringify(
			{
				schema: 1,
				experiment: opts.experiment,
				cliHash: opts.cliHash,
				parallel: opts.parallel,
				reps: opts.reps,
				budget: opts.budget,
				ledger: opts.sharedBudget?.path ?? null,
				sharedReservation: reservationId ?? null,
				jobs: jobs.map(({ probe, target, repetition }, index) => ({
					probe,
					assertionHash: hash(probe.assertions),
					seedFingerprint:
						module.seeds.find(
							(seed) =>
								seed.id === probe.seed.id &&
								seed.version === probe.seed.version,
						)?.fingerprint ?? null,
					agent: target.adapter.id,
					adapterVersion: target.adapter.version,
					config: target.adapter.config,
					requestedModel: target.model,
					effectiveModel: null,
					nativeVersion: null,
					reasoning: null,
					snapshot: target.snapshot ?? null,
					repetition,
					allowance: allowances?.[index] ?? null,
				})),
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
}

/** Stop a pair when observed native configuration differs from its earlier counterpart. */
export async function checkPairedControls(
	current: { value: StoredRun; path: string },
	previous: StoredRun[],
): Promise<void> {
	const value = current.value;
	if (
		!value.adapter.runtime.snapshot ||
		(value.result.status !== "uncovered" && value.result.status !== "pass")
	) {
		return;
	}
	const counterpart = previous.find(
		(run) =>
			run.agent === value.agent &&
			run.probe.id === value.probe.id &&
			run.run.identity.model === value.run.identity.model &&
			run.run.identity.repetition === value.run.identity.repetition &&
			run.run.identity.skillHash !== value.run.identity.skillHash,
	);
	if (!counterpart) {
		return;
	}
	const differences = pairedDifferences(counterpart, value);
	if (!differences.length) {
		return;
	}
	value.run.evidence.termination = "unsupported";
	value.run.evidence.detail = `Paired controlled identities changed: ${differences.join(", ")}`;
	value.adapter.runtime.failureCause = "configuration-mismatch";
	value.result = assessRun(value.probe, value.run.evidence);
	await saveResult(current.path, value);
}
