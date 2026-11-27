import type { AgentPick } from "../models";
import {
	idFor,
	LINEUP_COLORS,
	type LineupColor,
	ROUTE_DEPTHS,
	ROUTE_KINDS,
	type RouteDepth,
	type RouteKind,
	RULES_FORMAT,
} from "./cells";
import { DEFAULT_LINEUPS } from "./default-lineups";
import type { Lineup } from "./rules";

/**
 * Brings an older `auto-pick.json` up to the current format before it is
 * checked; anything else comes back as it was. Each kind at each depth goes
 * to the lineup of the rule that used to match it first.
 */
export function migrateRules(value: unknown): unknown {
	return fromRules(fromFormat1(value));
}

/** An older rule: what it matched, in order, and whom it picked. */
interface OldRule {
	kind: string;
	depth: string;
	clarity?: string;
	picks: AgentPick[];
}

/** Format 1 mappings to format 2 in order, keeping their picks and pace. */
function fromFormat1(value: unknown): unknown {
	if (
		value === null ||
		typeof value !== "object" ||
		!("format" in value) ||
		value.format !== 1 ||
		!("rules" in value) ||
		!Array.isArray(value.rules)
	) {
		return value;
	}
	const depths: Record<string, string> = {
		easy: "shallow",
		medium: "moderate",
		hard: "deep",
		"*": "*",
	};
	return {
		...value,
		format: 2,
		rules: value.rules.map((rule: unknown) => {
			if (rule === null || typeof rule !== "object") {
				return rule;
			}
			const { difficulty, ...rest } = rule as Record<string, unknown>;
			return {
				...rest,
				kind:
					rest.kind === "lookup" || rest.kind === "mechanical"
						? "*"
						: rest.kind,
				depth:
					rest.depth ??
					(typeof difficulty === "string"
						? difficulty === "*" && rest.kind === "lookup"
							? "shallow"
							: difficulty === "*" && rest.kind === "mechanical"
								? "moderate"
								: (depths[difficulty] ?? difficulty)
						: difficulty),
			};
		}),
	};
}

/**
 * Format 2's ordered rules as lineups and routes: each kind and depth goes to
 * a lineup of the picks of the first rule that matched it, a rule naming a
 * certainty never matching, as certainty no longer routes. Rules with the
 * same picks share one lineup, named as the defaults name it when it has
 * their picks, else after the rule.
 */
function fromRules(value: unknown): unknown {
	if (
		value === null ||
		typeof value !== "object" ||
		!("format" in value) ||
		value.format !== 2 ||
		!("rules" in value) ||
		!Array.isArray(value.rules)
	) {
		return value;
	}
	const rules = value.rules as OldRule[];
	const lineups: Lineup[] = [];
	const byRule = new Map<number, string>();
	// How many of kind and depth the rule a lineup is named after leaves open.
	const breadth = new Map<string, number>();
	const open = (rule: OldRule) =>
		(rule.kind === "*" ? 1 : 0) + (rule.depth === "*" ? 1 : 0);
	const lineupOf = (at: number): string | undefined => {
		const known = byRule.get(at);
		if (known !== undefined) {
			return known;
		}
		const rule = rules[at];
		if (rule === undefined || !Array.isArray(rule.picks)) {
			return undefined;
		}
		const exact = lineups.find((each) => samePicks(each.picks, rule.picks));
		if (exact !== undefined) {
			// A shared lineup takes the name of the broadest rule sharing it.
			const was = exact.id;
			if (
				!DEFAULT_LINEUPS.some((each) => each.id === was) &&
				open(rule) > (breadth.get(was) ?? 0)
			) {
				const others = lineups.filter((each) => each !== exact);
				exact.name = unique(oldName(rule), others);
				exact.id = idFor(exact.name, others);
				breadth.delete(was);
				breadth.set(exact.id, open(rule));
				for (const [key, id] of byRule) {
					if (id === was) {
						byRule.set(key, exact.id);
					}
				}
			}
			byRule.set(at, exact.id);
			return exact.id;
		}
		const joined =
			rule.kind === "*" && rule.depth === "*"
				? lineups.find((each) => permutes(each.picks, rule.picks))
				: undefined;
		if (joined !== undefined) {
			byRule.set(at, joined.id);
			return joined.id;
		}
		const named = DEFAULT_LINEUPS.find(
			(each) =>
				samePicks(each.picks, rule.picks) &&
				!lineups.some((taken) => taken.id === each.id),
		);
		const name = named?.name ?? unique(oldName(rule), lineups);
		const lineup: Lineup = {
			id: named?.id ?? idFor(name, lineups),
			name,
			color: colorFor(named?.color, lineups),
			picks: rule.picks,
		};
		lineups.push(lineup);
		breadth.set(lineup.id, open(rule));
		byRule.set(at, lineup.id);
		return lineup.id;
	};
	const matched = (kind: RouteKind, depth: RouteDepth) =>
		rules.findIndex(
			(rule) =>
				(rule.kind === "*" || rule.kind === kind) &&
				(rule.depth === "*" || rule.depth === depth) &&
				(rule.clarity === undefined || rule.clarity === "*"),
		);
	// Lineups are made in the rules' order, so the catch-all, last, can join one.
	const used = ROUTE_KINDS.flatMap((kind) =>
		ROUTE_DEPTHS.map((depth) => matched(kind, depth)),
	);
	for (const at of [...new Set(used)].sort((one, other) => one - other)) {
		lineupOf(at);
	}
	const routes: Record<string, Record<string, string | undefined>> = {};
	for (const kind of ROUTE_KINDS) {
		const row: Record<string, string | undefined> = {};
		for (const depth of ROUTE_DEPTHS) {
			row[depth] = lineupOf(matched(kind, depth));
		}
		routes[kind] = row;
	}
	const { rules: _, ...rest } = value as Record<string, unknown>;
	return { ...rest, format: RULES_FORMAT, lineups, routes };
}

/** Whether two pick lists are the same picks in the same order. */
function samePicks(
	one: readonly AgentPick[],
	other: readonly AgentPick[],
): boolean {
	return (
		one.length === other.length &&
		one.every((pick, at) => samePick(pick, other[at]))
	);
}

/**
 * Whether two pick lists are the same picks in any order: the old catch-all,
 * so often the moderate rule's picks reordered, joins that lineup.
 */
function permutes(
	one: readonly AgentPick[],
	other: readonly AgentPick[],
): boolean {
	return (
		one.length === other.length &&
		one.every((pick) => other.some((each) => samePick(pick, each)))
	);
}

function samePick(one: AgentPick, other: AgentPick | undefined): boolean {
	return (
		other !== undefined &&
		one.agent === other.agent &&
		one.model === other.model &&
		one.effort === other.effort
	);
}

/** An older rule in words: `Bugfix deep`, `Shallow`, `Fallback`. */
function oldName(rule: OldRule): string {
	const kind =
		rule.kind === "*"
			? ""
			: ({
					bugfix: "Bugfix",
					design: "Design",
					open: "Open-ended",
					devops: "DevOps",
				}[rule.kind] ?? rule.kind);
	const depth =
		rule.depth === "*"
			? ""
			: ({ shallow: "shallow", moderate: "moderate", deep: "deep" }[
					rule.depth
				] ?? rule.depth);
	const words = [kind, depth].filter((each) => each !== "").join(" ");
	return words === ""
		? "Fallback"
		: words.charAt(0).toUpperCase() + words.slice(1);
}

/** `name`, or `name 2` and on when a lineup has it already. */
function unique(name: string, lineups: readonly Lineup[]): string {
	let at = 1;
	let candidate = name;
	while (
		lineups.some((each) => each.name.toLowerCase() === candidate.toLowerCase())
	) {
		at += 1;
		candidate = `${name} ${at}`;
	}
	return candidate;
}

/**
 * `wanted` when no lineup has it yet, else the first color none has, cycling
 * once every color is taken.
 */
function colorFor(
	wanted: LineupColor | undefined,
	lineups: readonly Lineup[],
): LineupColor {
	const taken = (color: LineupColor) =>
		lineups.some((each) => each.color === color);
	if (wanted !== undefined && !taken(wanted)) {
		return wanted;
	}
	return (
		LINEUP_COLORS.find((each) => !taken(each)) ??
		LINEUP_COLORS[lineups.length % LINEUP_COLORS.length] ??
		"slate"
	);
}
