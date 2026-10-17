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
					run.adapter.runtime.nativeUsageComplete !== false &&
					run.result.status !== "infrastructure-error",
			),
		);
	}
}

export function finishUsage(
	context: import("./probe-record").RunContext,
	allowance: Readonly<Allowance> | undefined,
	metering: import("./probe-affordability").Metering | undefined,
	warnings: string[],
): void {
	const { usage, evidence, runtime } = context;
	if (
		allowance &&
		((usage.tokens !== null &&
			(!Number.isSafeInteger(usage.tokens) ||
				usage.tokens < 0 ||
				(usage.tokens > allowance.tokens &&
					(metering?.limits?.tokens ?? "hard") === "hard"))) ||
			(usage.costUsd !== null &&
				(!Number.isFinite(usage.costUsd) ||
					usage.costUsd < 0 ||
					(usage.costUsd * 1000000 > allowance.microUsd &&
						(metering?.limits?.costUsd ?? "hard") === "hard"))))
	) {
		evidence.termination = "infrastructure-error";
		evidence.detail =
			"Provider violated its reserved metering contract; cost guarantee cannot be claimed";
	}
	if (allowance) {
		runtime.overshoot = {
			tokens:
				usage.tokens === null
					? null
					: Math.max(0, usage.tokens - allowance.tokens),
			microUsd:
				usage.costUsd === null
					? null
					: Math.max(
							0,
							Math.ceil(usage.costUsd * 1000000) - allowance.microUsd,
						),
		};
		if (metering?.limits) {
			warnings.push(
				`Native budget policy: ${JSON.stringify(metering.limits)}; monitored limits may overshoot; unavailable usage stays unknown.`,
			);
		}
	}
}

export function observeUsage(
	usage: { tokens: number | null; costUsd: number | null },
	value: { tokens: number | null; costUsd: number | null },
	allowance?: Readonly<Allowance>,
): boolean {
	for (const [key, total] of Object.entries(value)) {
		if (
			total !== null &&
			(!Number.isFinite(total) ||
				total < 0 ||
				(key === "tokens" && !Number.isSafeInteger(total)))
		) {
			throw new Error("Invalid native usage");
		}
	}
	usage.tokens =
		value.tokens === null ? null : Math.max(usage.tokens ?? 0, value.tokens);
	usage.costUsd =
		value.costUsd === null ? null : Math.max(usage.costUsd ?? 0, value.costUsd);
	return (
		!!allowance &&
		((usage.tokens !== null && usage.tokens >= allowance.tokens) ||
			(usage.costUsd !== null && usage.costUsd * 1000000 >= allowance.microUsd))
	);
}
