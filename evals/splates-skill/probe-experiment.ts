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

/** What `batch.json` holds: one invocation and every cell it planned. */
export interface Batch {
	schema: 1;
	skill: string;
	startedAt: string;
	cells: {
		probe: string;
		aspect: string;
		requirement: string;
		agent: string;
		adapterVersion: string;
		model: string | null;
		effort?: string;
		repetition: number;
	}[];
}

export async function saveBatch(
	jobs: { probe: Probe; target: Target; repetition: number }[],
	opts: RunOptions,
): Promise<void> {
	if (!opts.batch) {
		return;
	}
	const batch: Batch = {
		schema: 1,
		...opts.batch,
		cells: jobs.map(({ probe, target, repetition }) => ({
			probe: probe.id,
			aspect: probe.aspect,
			requirement: probe.requirement.id,
			agent: target.adapter.id,
			adapterVersion: `${target.adapter.id}@${target.adapter.version}`,
			model: target.model,
			...(target.effort ? { effort: target.effort } : {}),
			repetition,
		})),
	};
	await writeFile(
		join(opts.directory, "batch.json"),
		`${JSON.stringify(batch, null, 2)}\n`,
	);
}

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
					...(target.effort ? { requestedEffort: target.effort } : {}),
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
			(run.run.identity.effort ?? null) ===
				(value.run.identity.effort ?? null) &&
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
