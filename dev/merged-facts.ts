import { findingKeys, type Measure, measured, outlier } from "../baselines";
import type { Finding } from "../findings";
import type { Landed } from "../landed";
import { duration } from "./stats-advice";

/** What the merged card says of how a task went, a line each. */
export interface MergedFacts {
	stats: Stat[];
	/** Null when the gate passed it the first time. */
	gate: Fact[] | null;
	/** Most severe first. */
	findings: Fact[];
}

/** One figure, beside its project's usual. */
export interface Stat {
	label: string;
	value: string;
	/** What it was made of, as working beside waiting; null for nothing more. */
	detail: string | null;
	/** Its project's median; null with too few tasks to say. */
	median: string | null;
	/** Past its project's 90th percentile, or twice its median. */
	high: boolean;
}

export interface Fact {
	text: string;
	/** "3rd time this week" when it came up before in its project; null otherwise. */
	again: string | null;
}

/** The findings that are not the gate's, the most worth acting on first. */
export const SEVERITY: Finding["kind"][] = [
	"stopped",
	"overturned",
	"challenged",
	"repeated_failure",
	"adherence",
	"churn",
	"interrupted",
];

/** What the card says of `landed`, from what its outcome kept. */
export function mergedFacts({ outcome, baseline }: Landed): MergedFacts {
	const values = measured(outcome);
	const stat = (
		measure: Measure,
		label: string,
		value: string,
		detail: string | null,
		show: (value: number) => string,
	): Stat => {
		const spread = baseline?.measures[measure] ?? null;
		const own = values[measure];
		return {
			label,
			value,
			detail,
			median: spread === null ? null : show(spread.median),
			high: own !== null && outlier(own, spread),
		};
	};
	const stats: Stat[] = [
		stat(
			"spentMs",
			"Time",
			duration(values.spentMs ?? 0),
			outcome.workedMs === undefined
				? null
				: `worked ${duration(outcome.workedMs)} · waited ${duration(outcome.waitedMs ?? 0)}`,
			duration,
		),
	];
	if (outcome.usage !== undefined) {
		stats.push(
			outcome.usage.cost === null
				? {
						label: "Tokens",
						value: `${tokens(outcome.usage.output)} out`,
						detail: null,
						median: null,
						high: false,
					}
				: stat(
						"cost",
						"Cost",
						dollars(outcome.usage.cost.amount),
						null,
						dollars,
					),
		);
	}
	if (outcome.size !== undefined) {
		stats.push(
			stat(
				"lines",
				"Size",
				`+${outcome.size.added} −${outcome.size.removed}`,
				`${outcome.size.files} ${outcome.size.files === 1 ? "file" : "files"}`,
				(lines) => `${Math.round(lines)} lines`,
			),
		);
	}
	stats.push(
		stat(
			"involvement",
			"Asked you",
			times(values.involvement ?? 0),
			null,
			(rounds) => times(Math.round(rounds)),
		),
	);
	const found = outcome.findings ?? [];
	const fact = (finding: Finding): Fact => ({
		text: said(finding),
		again: again(baseline?.findings[findingKeys(finding).at(-1) ?? ""] ?? 0),
	});
	const gate = found.filter(
		(each) => each.kind === "gate" || each.kind === "retried",
	);
	return {
		stats,
		// Older outcomes kept no findings, so they say nothing of the gate.
		gate:
			outcome.findings === undefined && outcome.failedMerges > 0
				? [
						{
							text: `Failed to merge ${times(outcome.failedMerges)}`,
							again: null,
						},
					]
				: gate.length === 0
					? null
					: gate.map(fact),
		findings: found
			.filter((each) => each.kind !== "gate" && each.kind !== "retried")
			.toSorted(
				(one, other) =>
					SEVERITY.indexOf(one.kind) - SEVERITY.indexOf(other.kind),
			)
			.map(fact),
	};
}

/** A finding as one line of the card. */
function said(finding: Finding): string {
	switch (finding.kind) {
		case "gate":
			switch (finding.reason) {
				case "tests_failed":
					return finding.tests?.length
						? `Tests failed: ${finding.tests.join(", ")}`
						: "The gate's checks failed";
				case "conflict":
					return finding.files?.length
						? `Conflicted in ${finding.files.join(", ")}`
						: "Conflicted with its base";
				case "merge_failed":
					return `Could not land${finding.error ? `: ${finding.error.split("\n")[0]}` : ""}`;
				case "budget_exhausted":
					return "Ran out of merge attempts";
			}
			return "The gate turned it away";
		case "retried":
			return `Given more attempts ${times(finding.times)}`;
		case "stopped":
			return "You stopped a turn";
		case "interrupted":
			return "A lost connection cut a turn short";
		case "overturned":
			return `You picked another choice than the agent's ${times(finding.picks)}`;
		case "challenged":
			return `You challenged ${finding.assumptions} ${finding.assumptions === 1 ? "assumption" : "assumptions"}`;
		case "repeated_failure":
			return `\`${finding.command}\` failed ${finding.times} times`;
		case "churn":
			return `Edited ${finding.edited} lines to land ${finding.landed}`;
		case "adherence":
			return `Mostly missed the skill's ${finding.check} check, passing ${finding.passed} of ${finding.passed + finding.failed}`;
	}
}

/** "3rd time this week" for a finding its project's tasks had `count` times, this one among them. */
function again(count: number): string | null {
	return count < 2 ? null : `${ordinal(count)} time this week`;
}

function ordinal(count: number): string {
	const tens = count % 100;
	const suffix =
		tens >= 11 && tens <= 13
			? "th"
			: (["th", "st", "nd", "rd"][count % 10] ?? "th");
	return `${count}${suffix}`;
}

function times(count: number): string {
	return count === 0
		? "never"
		: count === 1
			? "once"
			: count === 2
				? "twice"
				: `${count} times`;
}

function dollars(amount: number): string {
	return `$${amount.toFixed(2)}`;
}

function tokens(count: number): string {
	return count < 1000 ? `${count}` : `${(count / 1000).toFixed(1)}k`;
}
