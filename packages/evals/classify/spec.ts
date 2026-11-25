import {
	type AttachmentInfo,
	type Classification,
	CONTEXT_CLASSES,
	DEPTHS,
	KINDS,
	type TaskClass,
} from "@splates/server/auto-pick";
import type { PassRule } from "@splates/server/evals/browser";

/** Declares a spec: its sentence, the request, and what the judge should say of it. */
export function it(
	sentence: string,
	spec: Request & { judged: Judged; key?: string; pass?: PassRule },
): ClassifySpec {
	const { judged, key, pass, ...request } = spec;
	if (expectations(judged).length === 0) {
		throw new Error(`classify spec "${sentence}" expects nothing`);
	}
	return {
		id: `auto-pick/${key ?? slugify(sentence)}`,
		sentence,
		groups: [SUITE],
		request,
		judged,
		...(pass === undefined ? {} : { pass }),
	};
}

/** The groups of questions Auto pick asks, as `classify` names them. */
export const GROUPS = {
	kind: KINDS,
	depth: DEPTHS,
	...CONTEXT_CLASSES,
} as const;

export type Group = keyof typeof GROUPS;

/** Each group's class ids. */
type IdsOf<G extends Group> = (typeof GROUPS)[G] extends readonly TaskClass<
	infer Id
>[]
	? Id
	: never;

/**
 * What the judge should say of a request: per group, whether each named
 * class holds (true) or does not (false). Classes left out are not graded.
 */
export type Judged = { [G in Group]?: { [Id in IdsOf<G>]?: boolean } };

/** A request Auto pick classifies, as a task or a first prompt reaches it. */
export interface Request {
	subject: string;
	detail: string;
	attachments?: readonly AttachmentInfo[];
}

/** One classification spec: a request and what the judge should say of it. */
export interface ClassifySpec {
	/** `auto-pick/<slug>`, stable across rewording when `key` is given. */
	id: string;
	/** The spec's sentence, as the Evals page shows it. */
	sentence: string;
	/** Group path, outermost first. */
	groups: string[];
	request: Request;
	judged: Judged;
	/** How many of its last graded runs on an agent must pass; 2 of 3 when absent. */
	pass?: PassRule;
}

/** One expected answer of a spec, graded as a check. */
export interface Expectation {
	/** `kind:bugfix`, the question's id as `classify` asks it. */
	id: string;
	group: Group;
	class: string;
	label: string;
	holds: boolean;
}

/** The suite Auto pick classification specs are listed under. */
export const SUITE = "auto pick classification";

/** A probability on this side of it counts as the class holding: the cut `decide` routes on. */
export const CUT = 0.5;

/** Every class a spec grades, in group order. */
export function expectations(judged: Judged): Expectation[] {
	return (Object.keys(GROUPS) as Group[]).flatMap((group) => {
		const wanted = (judged[group] ?? {}) as Record<string, boolean | undefined>;
		return (GROUPS[group] as readonly TaskClass<string>[]).flatMap((each) => {
			const holds = wanted[each.id];
			return holds === undefined
				? []
				: [
						{
							id: `${group}:${each.id}`,
							group,
							class: each.id,
							label: each.label,
							holds,
						},
					];
		});
	});
}

/** The probability a classification gave an expectation's class; a coin toss when it holds none. */
export function probabilityOf(
	classification: Classification,
	expectation: Expectation,
): number {
	const field = expectation.group === "kind" ? "kinds" : expectation.group;
	const answers = classification[field] as Record<string, number> | undefined;
	return answers?.[expectation.class] ?? 0.5;
}

/** Whether a probability lands on the side an expectation wants. */
export function met(expectation: Expectation, probability: number): boolean {
	return expectation.holds ? probability > CUT : probability < CUT;
}

/** What an expectation checks, in words: `Reads as Bugfix (over 50%)`. */
export function aboutOf(expectation: Expectation): string {
	const percent = Math.round(CUT * 100);
	return expectation.holds
		? `${groupLabel(expectation.group)} reads as ${expectation.label} (over ${percent}%)`
		: `${groupLabel(expectation.group)} does not read as ${expectation.label} (under ${percent}%)`;
}

function groupLabel(group: Group): string {
	return group[0]?.toUpperCase() + group.slice(1);
}

function slugify(text: string): string {
	return (
		text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 64)
			.replace(/-+$/, "") || "spec"
	);
}
