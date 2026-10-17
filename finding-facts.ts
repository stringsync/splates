import { findingKeys } from "./baselines";
import type { Finding } from "./findings";
import type { Landed } from "./landed";

/** One thing that went worse than it could have, as the merged card says it. */
export interface Fact {
	text: string;
	/** "3rd time this week" when it came up before in its project; null otherwise. */
	again: string | null;
	/** What it was found from; null for an older outcome's count of failed merges. */
	finding: Finding | null;
}

/** What went worse in a merged task: the gate's turn-aways, and the rest. */
export interface FoundFacts {
	/** Null when the gate passed it the first time. */
	gate: Fact[] | null;
	/** Most severe first. */
	findings: Fact[];
}

/** A todo made of a fact: its line, and what more there is to say. */
export interface FactTodo {
	subject: string;
	text: string;
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

/** What went worse in `landed`, from what its outcome kept. */
export function foundFacts({ outcome, baseline }: Landed): FoundFacts {
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

/**
 * Findings the merged card lists but no todo is made of: the person's own
 * calls on the agent's picks, which are asking working as meant.
 */
export const UNTODOED: Finding["kind"][] = ["overturned", "challenged"];

/**
 * The todos `arbor merge` adds for what went worse in `landed`, the gate's
 * first: one a fact, as the merged card lists them, but for `UNTODOED`.
 */
export function factTodos(landed: Landed): FactTodo[] {
	const { gate, findings } = foundFacts(landed);
	return [...(gate ?? []), ...findings]
		.filter(
			(fact) => fact.finding === null || !UNTODOED.includes(fact.finding.kind),
		)
		.map((fact) => deferred(landed.outcome.task, fact));
}

/** The todo made of `fact`, found in `task` as it merged. */
export function deferred(task: string, fact: Fact): FactTodo {
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
