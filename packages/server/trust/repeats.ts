import type { DecisionSource, TrustDecision } from "./types";

/** How many matching overturns in a project make a repeat worth a rule. */
export const REPEAT_THRESHOLD = 3;

/**
 * How alike two questions' (or two answers') words must be to count as the
 * same correction, as the share of words they have in common; 0.4 would group
 * more loosely.
 */
export const SIMILARITY = 0.5;

/** The sources whose overturns are a pick the user would answer the same way again. */
const PICKS: readonly DecisionSource[] = ["question", "mockup", "unasked"];

/** Words too common to tell one question from another. */
const STOP = new Set(
	"the and for with that this which what should when where how does from into onto than then them they their there here have has had was were are will would could can its it's not but use used using one each any all our your you".split(
		" ",
	),
);

/** Overturned picks in a project the user corrected the same way. */
export interface Repeat {
	/** Stable while it grows: its first decision's id. */
	key: string;
	project: string;
	decisions: TrustDecision[];
}

/**
 * Groups the overturned picks among `decisions` into repeats: same project
 * and kind, questions alike in words, and (when both say) answers alike too.
 * Each joins the first group whose first decision it matches, oldest first,
 * so a group keeps its key as later decisions join it. Only groups of at
 * least `threshold` come back.
 */
export function repeatedCorrections(
	decisions: readonly TrustDecision[],
	{ threshold = REPEAT_THRESHOLD }: { threshold?: number } = {},
): Repeat[] {
	const overturns = decisions
		.filter(
			(each) => each.outcome === "overturned" && PICKS.includes(each.source),
		)
		.sort((left, right) => left.at.localeCompare(right.at));
	const groups: { seed: Words; decisions: TrustDecision[] }[] = [];
	for (const decision of overturns) {
		const mine = wordsOf(decision);
		const group = groups.find((each) => matches(each.seed, mine));
		if (group === undefined) {
			groups.push({ seed: mine, decisions: [decision] });
		} else {
			group.decisions.push(decision);
		}
	}
	return groups
		.filter((group) => group.decisions.length >= threshold)
		.map(({ seed, decisions }) => ({
			key: seed.decision.id,
			project: seed.decision.project,
			decisions,
		}));
}

interface Words {
	decision: TrustDecision;
	subject: Set<string>;
	instead: Set<string> | null;
}

function wordsOf(decision: TrustDecision): Words {
	return {
		decision,
		subject: tokens(decision.subject),
		instead: decision.instead === undefined ? null : tokens(decision.instead),
	};
}

function matches(seed: Words, other: Words): boolean {
	if (
		seed.decision.project !== other.decision.project ||
		seed.decision.kind !== other.decision.kind
	) {
		return false;
	}
	if (overlap(seed.subject, other.subject) < SIMILARITY) {
		return false;
	}
	return (
		seed.instead === null ||
		other.instead === null ||
		overlap(seed.instead, other.instead) >= SIMILARITY
	);
}

/** The lowercase words of `text` that tell it apart, plurals folded. */
export function tokens(text: string): Set<string> {
	return new Set(
		(text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
			.filter((word) => !STOP.has(word) && (word.length > 2 || /\d/.test(word)))
			.map((word) =>
				word.length > 3 && word.endsWith("s") && !word.endsWith("ss")
					? word.slice(0, -1)
					: word,
			),
	);
}

/** Shared words over all words (Jaccard); 1 for two empty sets. */
export function overlap(left: Set<string>, right: Set<string>): number {
	if (left.size === 0 && right.size === 0) {
		return 1;
	}
	let shared = 0;
	for (const word of left) {
		if (right.has(word)) {
			shared += 1;
		}
	}
	return shared / (left.size + right.size - shared);
}

/** Subject prefix shared by every rule suggestion Backlog task. */
export const RULE_TASK_PREFIX = "Write down a rule for: ";

/**
 * The board task's subject and words that have an agent propose writing
 * `repeat` down as a project rule, through a plan card, changing nothing
 * until the user approves.
 */
export function ruleTaskText(repeat: Repeat): {
	subject: string;
	text: string;
} {
	const first = repeat.decisions[0] as TrustDecision;
	const lines = repeat.decisions.map((each) => {
		const picked =
			each.picked === undefined ? "" : `; the agent picked "${each.picked}"`;
		const instead =
			each.instead === undefined ? "" : `; the user chose "${each.instead}"`;
		const where = [
			each.agent + (each.model === null ? "" : ` (${each.model})`),
			each.task === null ? null : `task ${each.task}`,
			each.conversation === null ? null : `conversation ${each.conversation}`,
			each.at.slice(0, 10),
		]
			.filter(Boolean)
			.join(", ");
		return `- "${each.subject}"${picked}${instead} [${where}]`;
	});
	return {
		subject: `${RULE_TASK_PREFIX}${clip(first.subject, 80)}`,
		text: [
			`The user overturned agents' ${first.kind} picks the same way ${repeat.decisions.length} times in this project:`,
			"",
			...lines,
			"",
			"Read what the user chose each time and, if one rule covers them, propose writing it down where agents in this project will read it (the project's AGENTS.md, or the skill the question came from) so the question stops coming back. Propose it with a plan card quoting the rule's exact words, and write nothing until the user approves.",
			"",
			"If the answers do not share one rule, remove this task with `--reason nothing`. Removing it dismisses the suggestion: it is not made again.",
		].join("\n"),
	};
}

function clip(text: string, max: number): string {
	const line = text.trim().replace(/\s+/g, " ");
	return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}
