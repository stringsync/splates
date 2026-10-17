import type { Probe } from "./probe";
import { type Allowance, admit } from "./probe-affordability";
import type { RunOptions, StoredRun, Target } from "./probe-record";

/** Invocation admission precedes shared reservations; no partially admitted batch launches. */
export async function reserveBudget(
	jobs: { probe: Probe; target: Target }[],
	opts: RunOptions,
) {
	if (opts.sharedBudget && !opts.budget) {
		throw new Error(
			"Shared eval accounting requires bounded provider admission",
		);
	}
	const allowances = opts.budget ? admit(jobs, opts.budget) : undefined;
	const charged =
		allowances?.filter(
			(value): value is Readonly<Allowance> => value !== undefined,
		) ?? [];
	const reservationId =
		opts.sharedBudget && charged.length
			? await opts.sharedBudget.reserve(charged)
			: undefined;
	return { allowances, reservationId };
}

/** Keep actual usage separate from the conservative, never-refunded reservation. */
export async function recordBudget(
	results: StoredRun[],
	reservationId: string | undefined,
	opts: RunOptions,
): Promise<void> {
	if (reservationId && opts.sharedBudget) {
		const models = results.filter(
			(run) => run.probe.execution.kind === "agent",
		);
		await opts.sharedBudget.finish(
			reservationId,
			models.map((run) => ({
				tokens: run.run.usage.tokens,
				costUsd: run.run.usage.costUsd,
			})),
			models.every(
				(run) =>
					run.run.evidence.termination === "stop" &&
					run.result.status !== "infrastructure-error",
			),
		);
	}
}
