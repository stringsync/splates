import { findingKeys, type Measure, measured, outlier } from "../baselines";
import { keptDecisions, madeBy } from "../decided";
import type { Finding } from "../findings";
import type { Landed } from "../landed";
import type { TodoForm } from "./api";
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
	/** Lines added and removed for a size, and calls by who made them, which the card colors. */
	value: string | Lines | Decided;
	/** What it was made of, as working beside waiting; null for nothing more. */
	detail: string | null;
	/** Past its project's 90th percentile, or twice its median. */
	high: boolean;
}

export interface Lines {
	added: number;
	removed: number;
}

export interface Fact {
	text: string;
	/** "3rd time this week" when it came up before in its project; null otherwise. */
	again: string | null;
	/** What it was found from; null for an older outcome's count of failed merges. */
	finding: Finding | null;
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
		value: Stat["value"],
		detail: string | null,
	): Stat => {
		const spread = baseline?.measures[measure] ?? null;
		const own = values[measure];
		return {
			label,
			value,
			detail,
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
		),
	];
	// A task merged in the turn it began in kept none of its tokens, since a
	// turn's usage is logged only as the turn ends, after the merge.
	if (outcome.usage !== undefined && outcome.usage.output > 0) {
		const read = `${tokens(outcome.usage.input)} in · ${tokens(outcome.usage.output)} out`;
		stats.push(
			outcome.usage.cost === null
				? { label: "Tokens", value: read, detail: null, high: false }
				: stat("cost", "Cost", dollars(outcome.usage.cost.amount), read),
		);
	}
	if (outcome.size !== undefined) {
		stats.push(
			stat(
				"lines",
				"Size",
				{ added: outcome.size.added, removed: outcome.size.removed },
				`${outcome.size.files} ${outcome.size.files === 1 ? "file" : "files"}`,
			),
		);
	}
	// Older outcomes kept no calls, so they say nothing of them.
	if (keptDecisions(outcome)) {
		stats.push(
			stat(
				"decidedByYou",
				"Decisions",
				{
					byYou: madeBy(outcome, "decidedByYou"),
					byAgent: madeBy(outcome, "decidedByAgents"),
				},
				null,
			),
		);
	}
	const found = outcome.findings ?? [];
	const fact = (finding: Finding): Fact => ({
		text: said(finding),
		again: again(baseline?.findings[findingKeys(finding).at(-1) ?? ""] ?? 0),
		finding,
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
							finding: null,
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

/** The calls a task made, by who made them. */
export interface Decided {
	byYou: number;
	byAgent: number;
}

/** The todo Defer makes of `fact`, found in `task` as it merged. */
export function deferred(task: string, fact: Fact): TodoForm {
	return {
		subject: plain(fact.text),
		text: [
			`Found in \`${task}\` as it merged: ${fact.text}${fact.again === null ? "." : `, the ${fact.again}.`}`,
			...(fact.finding === null
				? []
				: ["", "```json", JSON.stringify(fact.finding, null, 2), "```"]),
		].join("\n"),
	};
}

/** `text` without the code spans the card shows it in, for a todo's line. */
function plain(text: string): string {
	return text.replaceAll("`", "");
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
	return count < 1000
		? `${count}`
		: count < 1_000_000
			? `${(count / 1000).toFixed(1)}k`
			: `${(count / 1_000_000).toFixed(1)}M`;
}
