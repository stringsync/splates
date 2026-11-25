import { type Scenario, specTitleOf } from "../scenario";
import type { Found } from "./discover";

/** Bun-test-style filters for narrowing discovered scenarios. */
export interface FilterOptions {
	/** Skill names (`--skill`); all when empty. */
	skills?: readonly string[];
	/** Exact hidden scenario ids (`--scenario`); all when empty. */
	ids?: readonly string[];
	/** Group paths (`--group`), e.g. `asking` or `splates skill > asking`. */
	groups?: readonly string[];
	/** Word or regex patterns (`-t` / `--test-name-pattern`) matched against spec sentences and group paths. */
	patterns?: readonly string[];
	/** Exact spec sentences, `group > sentence` titles, or hidden ids (`--spec`). */
	specs?: readonly string[];
}

/** Returns the scenarios of `found` matching every non-empty filter in `opts`. */
export function filterScenarios(
	found: readonly Found[],
	opts: FilterOptions = {},
): Found[] {
	const skills = opts.skills ?? [];
	const ids = opts.ids ?? [];
	const groups = opts.groups ?? [];
	const patterns = opts.patterns ?? [];
	const specs = opts.specs ?? [];
	return found.filter(
		(each) =>
			(skills.length === 0 || skills.includes(each.skill)) &&
			(ids.length === 0 || ids.includes(each.scenario.id)) &&
			(groups.length === 0 ||
				groups.some((group) => matchesGroup(each.scenario, group))) &&
			(patterns.length === 0 ||
				patterns.some((pattern) => matchesPattern(each.scenario, pattern))) &&
			(specs.length === 0 ||
				specs.some((spec) => matchesSpec(each.scenario, spec))),
	);
}

/** True when `query` matches a contiguous slice of `scenario`'s group path (or legacy `aspect`). */
export function matchesGroup(scenario: Scenario, query: string): boolean {
	const wanted = splitPath(query);
	if (wanted.length === 0) {
		return false;
	}
	const path =
		scenario.groups && scenario.groups.length > 0
			? scenario.groups.map(normalize)
			: splitPath(scenario.aspect);
	if (wanted.length > path.length) {
		return false;
	}
	for (let start = 0; start <= path.length - wanted.length; start += 1) {
		let ok = true;
		for (let offset = 0; offset < wanted.length; offset += 1) {
			if (path[start + offset] !== wanted[offset]) {
				ok = false;
				break;
			}
		}
		if (ok) {
			return true;
		}
	}
	return false;
}

/** True when `pattern` matches `scenario`'s group path and sentence (or legacy requirement) case-insensitively. */
export function matchesPattern(scenario: Scenario, pattern: string): boolean {
	const text = searchableTitle(scenario);
	try {
		return new RegExp(pattern, "i").test(text);
	} catch {
		return text.toLowerCase().includes(pattern.toLowerCase());
	}
}

/** True when `spec` names `scenario` by exact sentence, full `group > sentence` title, hidden id, or legacy requirement. */
export function matchesSpec(scenario: Scenario, spec: string): boolean {
	const trimmed = spec.trim();
	if (trimmed === "") {
		return false;
	}
	if (trimmed === scenario.id) {
		return true;
	}
	if (scenario.sentence !== undefined) {
		if (trimmed === scenario.sentence) {
			return true;
		}
		if (scenario.groups && scenario.groups.length > 0) {
			if (trimmed === [...scenario.groups, scenario.sentence].join(" > ")) {
				return true;
			}
			if (trimmed === [...scenario.groups, scenario.sentence].join(" ")) {
				return true;
			}
		}
	}
	return trimmed === scenario.requirement;
}

function searchableTitle(scenario: Scenario): string {
	const prefix =
		scenario.groups && scenario.groups.length > 0
			? scenario.groups
			: scenario.aspect === ""
				? []
				: [scenario.aspect];
	return [...prefix, specTitleOf(scenario)].join(" ");
}

function splitPath(text: string): string[] {
	return text
		.split(/[>/]/)
		.map(normalize)
		.filter((part) => part !== "");
}

function normalize(text: string): string {
	return text.trim().toLowerCase();
}
