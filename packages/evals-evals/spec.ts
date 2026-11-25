import type {
	Check,
	ExampleStep,
	Limits,
	Priority,
	Repo,
	Scenario,
	ScenarioFollowUp,
} from "./scenario";

/** An item inside `describe(...)`: one spec from `it(...)` or a nested `describe(...)`. */
export type SpecItem = Scenario | readonly Scenario[];

/** Options for `it(sentence, spec)`. */
export interface SpecDefinition {
	/** Stable hidden key (existing scenario id) so history and fingerprints survive rewording. */
	key?: string;
	/** What the person says to the agent. */
	message: string;
	/** One line on the repo and state the scenario starts from, backticks as code. */
	environment?: string;
	/** A sketched good reply, shown beside the spec. */
	example?: readonly ExampleStep[];
	/** Adds what the scenario needs to the minimal repo, before the seed commit. */
	seed?: (repo: Repo) => Promise<void>;
	/** Leaves uncommitted work in the repo, after the seed commit. */
	change?: (repo: Repo) => Promise<void>;
	/** Code checks for concrete expectations. */
	expect?: readonly Check[];
	/** Optional detailed context for the judge; falls back to the spec sentence plus its checks. */
	detail?: string;
	/** What the judge decides from the transcript; no judge when absent. */
	judge?: string;
	/** The judge for this scenario's rubric, as `claude:<model>[@<effort>]`, over the run's. */
	judgeWith?: string;
	limits?: Limits;
	/** Run order under a budget; over any `describe` priority, `normal` when unset everywhere. */
	priority?: Priority;
	followUp?: ScenarioFollowUp;
}

/** Options for `describe(subject, items, opts)`. */
export interface DescribeOptions {
	/** Priority of every spec inside that sets none itself, nor an inner `describe`. */
	priority?: Priority;
}

/** Options for `check(about, test, opts)`. */
export interface CheckOptions {
	/** Stable check id; derived from `about` when omitted. */
	id?: string;
	/** True for a check that needs live state and cannot be re-run during regrade. */
	live?: boolean;
}

const explicitKeys = new WeakSet<Scenario>();
const derivedSlugs = new WeakMap<Scenario, string>();

/** Groups specs under a subject or sub-group, building `Scenario[]`. */
export function describe(
	subject: string,
	items: readonly SpecItem[],
	opts: DescribeOptions = {},
): Scenario[] {
	const name = subject.trim();
	const out: Scenario[] = [];
	for (const item of items) {
		const list = Array.isArray(item) ? item : [item];
		for (const scenario of list) {
			const groups = [name, ...(scenario.groups ?? [])];
			const aspect = groups.join("/");
			const keepKey = explicitKeys.has(scenario);
			const leafSlug =
				derivedSlugs.get(scenario) ?? slugify(scenario.sentence ?? scenario.id);
			const id = keepKey
				? scenario.id
				: `${groups.map(slugify).join("/")}/${leafSlug}`;
			const next: Scenario = {
				...scenario,
				id,
				aspect,
				groups,
				...(scenario.priority === undefined && opts.priority !== undefined
					? { priority: opts.priority }
					: {}),
			};
			if (keepKey) {
				explicitKeys.add(next);
			} else {
				derivedSlugs.set(next, leafSlug);
			}
			out.push(next);
		}
	}
	return out;
}

/** Declares one eval spec sentence and its inputs, checks, and optional judge rubric. */
export function it(sentence: string, spec: SpecDefinition): Scenario {
	const leafSlug = slugify(sentence);
	const checks =
		spec.expect === undefined ? undefined : uniqueCheckIds(spec.expect);
	const scenario: Scenario = {
		id: spec.key ?? leafSlug,
		aspect: "",
		requirement: spec.detail ?? sentence,
		sentence,
		groups: [],
		...(spec.detail === undefined ? {} : { detail: spec.detail }),
		message: spec.message,
		...(spec.environment === undefined
			? {}
			: { environment: spec.environment }),
		...(spec.example === undefined ? {} : { example: spec.example }),
		...(spec.seed === undefined ? {} : { seed: spec.seed }),
		...(spec.change === undefined ? {} : { change: spec.change }),
		...(checks === undefined ? {} : { checks }),
		...(spec.judge === undefined ? {} : { judge: spec.judge }),
		...(spec.judgeWith === undefined ? {} : { judgeWith: spec.judgeWith }),
		...(spec.limits === undefined ? {} : { limits: spec.limits }),
		...(spec.priority === undefined ? {} : { priority: spec.priority }),
		...(spec.followUp === undefined ? {} : { followUp: spec.followUp }),
	};
	if (spec.key !== undefined) {
		explicitKeys.add(scenario);
	} else {
		derivedSlugs.set(scenario, leafSlug);
	}
	return scenario;
}

/** Declares one concrete code check as a sentence and its predicate. */
export function check(
	about: string,
	test: Check["test"],
	opts: CheckOptions = {},
): Check {
	return {
		id: opts.id ?? slugify(about),
		about,
		...(opts.live === undefined ? {} : { live: opts.live }),
		test,
	};
}

function uniqueCheckIds(checks: readonly Check[]): Check[] {
	const counts = new Map<string, number>();
	return checks.map((each) => {
		const seen = counts.get(each.id) ?? 0;
		counts.set(each.id, seen + 1);
		if (seen === 0) {
			return each;
		}
		return { ...each, id: `${each.id}-${seen + 1}` };
	});
}

function slugify(text: string): string {
	const slug = text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64)
		.replace(/-+$/, "");
	return slug || "spec";
}
