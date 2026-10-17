import type { Probe } from "./probe";
import type { Target } from "./probe-record";

/** Integer microdollars avoid floating-point rounding at admission boundaries. */
export interface Allowance {
	tokens: number;
	microUsd: number;
}
export const DEFAULT_BUDGET: Readonly<Allowance> = {
	tokens: 4000,
	microUsd: 100000,
};
export const MAX_BUDGET: Readonly<Allowance> = {
	tokens: 10000,
	microUsd: 250000,
};

/** A provider integration must bound all input/output, hidden reasoning, tools and retries before sending requests. */
export interface Metering {
	/** Pure, non-billable upper bound for the whole probe, including failures and retries; null means unknown. */
	quote(probe: Probe, model: string | null): Allowance | null;
	/** No spend beyond allowance, even after cancellation or missing usage; never fall back to an unbounded call. */
	run(
		context: import("./probe-record").RunContext,
		model: string | null,
		allowance: Readonly<Allowance>,
	): Promise<void>;
}

export function budget(tokens?: string, usd?: string): Allowance {
	if (usd !== undefined && !/^\d+(?:\.\d{1,6})?$/.test(usd)) {
		throw new Error(
			"--max-usd must be a positive decimal with at most six fractional digits",
		);
	}
	const [whole = "0", fraction = ""] = (usd ?? "0.10").split(".");
	const value = {
		tokens: tokens === undefined ? DEFAULT_BUDGET.tokens : Number(tokens),
		microUsd: Number(whole) * 1000000 + Number(fraction.padEnd(6, "0")),
	};
	validateAllowance(value);
	if (
		value.tokens > MAX_BUDGET.tokens ||
		value.microUsd > MAX_BUDGET.microUsd
	) {
		throw new Error("Hard invocation ceiling: 10000 total tokens and USD 0.25");
	}
	return value;
}

export function validateAllowance(value: Allowance): void {
	if (
		!Number.isSafeInteger(value.tokens) ||
		value.tokens <= 0 ||
		!Number.isSafeInteger(value.microUsd) ||
		value.microUsd <= 0
	) {
		throw new Error(
			"Metering requires positive safe integer token and microdollar bounds",
		);
	}
}

/** Reserve every combination before any seed/agent runs. Never refund unknown, failed or cancelled usage. */
export function admit(
	jobs: { probe: Probe; target: Target }[],
	limit: Allowance,
): (Readonly<Allowance> | undefined)[] {
	validateAllowance(limit);
	budget(String(limit.tokens), (limit.microUsd / 1000000).toFixed(6));
	let tokens = 0;
	let microUsd = 0;
	return jobs.map(({ probe, target }) => {
		if (probe.execution.kind === "cli") {
			return undefined;
		}
		const meter = target.adapter.metering;
		if (!meter) {
			throw new Error(
				`Unsupported metering for ${target.adapter.id}: no enforceable token/USD ceiling; no agents launched`,
			);
		}
		const quote = meter.quote(probe, target.model);
		if (!quote) {
			throw new Error(
				`Unknown metering/pricing for ${target.adapter.id}/${target.model}; no agents launched`,
			);
		}
		validateAllowance(quote);
		if (quote.tokens > probe.bounds.tokens) {
			throw new Error(`Quoted tokens exceed probe bound: ${probe.id}`);
		}
		tokens += quote.tokens;
		microUsd += quote.microUsd;
		if (
			!Number.isSafeInteger(tokens) ||
			!Number.isSafeInteger(microUsd) ||
			tokens > limit.tokens ||
			microUsd > limit.microUsd
		) {
			throw new Error(
				"Aggregate token/USD budget exceeded by selected probes, targets and repetitions; no agents launched",
			);
		}
		return Object.freeze({ ...quote });
	});
}

/** Legacy execution has no enforced aggregate metering; only reading existing reports is admitted. */
export function assertLegacyReport(args: string[]): void {
	if (args[0] !== "report") {
		throw new Error(
			"Legacy E2E model execution is disabled: skill-change gating and enforced aggregate metering are required. Existing e2e report is free.",
		);
	}
}
