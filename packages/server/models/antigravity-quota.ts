import type { Limit } from "../conversations";

const ALL_MODELS_PREFIX = "All Models · ";
const GROUP_STOP_WORDS = new Set(["all", "and", "model", "models"]);

/**
 * The active Antigravity quota rows in `limits` and whether the account reports
 * grouped windows or legacy per-model buckets.
 */
export function currentAntigravityLimits(limits: readonly Limit[]): {
	kind: "grouped" | "per-model";
	limits: Limit[];
} {
	const grouped = limits.filter((each) => !isPerModelLimit(each));
	const perModel = limits.filter(isPerModelLimit);
	if (grouped.length === 0) {
		return { kind: "per-model", limits: perModel };
	}
	// Drop stale Enterprise per-model rows once newer grouped windows exist (or vice versa).
	if (perModel.length > 0 && newestAt(perModel) > newestAt(grouped)) {
		return { kind: "per-model", limits: perModel };
	}
	const groups: string[] = [];
	for (const each of grouped) {
		const group = groupOf(each.window);
		if (!groups.includes(group)) {
			groups.push(group);
		}
	}
	const ordered = groups.flatMap((group) =>
		grouped
			.filter((each) => groupOf(each.window) === group)
			.toSorted(
				(one, other) => windowRank(one.window) - windowRank(other.window),
			),
	);
	return { kind: "grouped", limits: ordered };
}

/** Whether `model` (an id or display name) draws from Antigravity quota `group`. */
export function antigravityModelInGroup(model: string, group: string): boolean {
	const modelTokens = new Set(tokensOf(model));
	if (modelTokens.size === 0) {
		return false;
	}
	const groupTokens = tokensOf(group).filter(
		(token) => !GROUP_STOP_WORDS.has(token),
	);
	return groupTokens.some((token) => modelTokens.has(token));
}

/**
 * The Antigravity quota windows that apply to `model`, or all active windows
 * when no model is named.
 */
export function antigravityLimitsForModel(
	limits: readonly Limit[],
	model: string | undefined,
): Limit[] {
	const current = currentAntigravityLimits(limits);
	if (current.limits.length === 0) {
		return [];
	}
	if (current.kind === "grouped") {
		if (model === undefined || model.trim() === "") {
			return current.limits;
		}
		return current.limits.filter((each) =>
			antigravityModelInGroup(model, groupOf(each.window)),
		);
	}
	if (model === undefined || model.trim() === "") {
		return current.limits;
	}
	const wanted = normalizeModel(model);
	return current.limits.filter(
		(each) =>
			normalizeModel(
				each.window.slice(ALL_MODELS_PREFIX.length).replace(/ \([^)]*\)$/, ""),
			) === wanted,
	);
}

function isPerModelLimit(limit: Limit): boolean {
	return limit.window.startsWith(ALL_MODELS_PREFIX);
}

function newestAt(limits: readonly Limit[]): string {
	return limits.reduce(
		(best, each) => ((each.at ?? "") > best ? (each.at ?? "") : best),
		"",
	);
}

/** One grouped Antigravity quota family with its short display label and active windows. */
export interface AntigravityQuotaGroup {
	/** Raw group name as `agy` reports it (e.g. `"Gemini Models"`). */
	group: string;
	/** Short display label (e.g. `"Gemini"`, `"Claude & GPT"`). */
	label: string;
	/** Active windows belonging to this group, ordered shortest first. */
	limits: Limit[];
}

/**
 * The active grouped Antigravity quotas, each with its own windows; empty when
 * the account reports legacy per-model buckets or no limits.
 */
export function antigravityGroups(
	limits: readonly Limit[],
): AntigravityQuotaGroup[] {
	const current = currentAntigravityLimits(limits);
	if (current.kind !== "grouped" || current.limits.length === 0) {
		return [];
	}
	const grouped = new Map<string, Limit[]>();
	for (const each of current.limits) {
		const group = antigravityGroupOf(each.window);
		const existing = grouped.get(group);
		if (existing === undefined) {
			grouped.set(group, [each]);
		} else {
			existing.push(each);
		}
	}
	return [...grouped.entries()].map(([group, groupLimits]) => ({
		group,
		label: antigravityGroupLabel(group),
		limits: groupLimits,
	}));
}

/** The group prefix of an Antigravity window name (before `" · "`). */
export function antigravityGroupOf(window: string): string {
	const index = window.indexOf(" · ");
	return index === -1 ? window : window.slice(0, index);
}

/** Short human-readable label for an Antigravity quota group (`"Gemini"`, `"Claude & GPT"`). */
export function antigravityGroupLabel(group: string): string {
	return group
		.replace(/\s+models$/i, "")
		.replace(/\band\b/gi, "&")
		.trim();
}

function groupOf(window: string): string {
	return antigravityGroupOf(window);
}

function windowRank(window: string): number {
	const suffix = window.split(" · ").at(-1)?.trim().toLowerCase() ?? "";
	if (suffix === "five hour" || suffix === "5-hour" || suffix === "5h") {
		return 0;
	}
	if (suffix === "daily" || suffix === "day") {
		return 1;
	}
	if (suffix === "weekly" || suffix === "week") {
		return 2;
	}
	if (suffix === "monthly" || suffix === "month") {
		return 3;
	}
	return 4;
}

function tokensOf(value: string): string[] {
	return value
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length > 0);
}

function normalizeModel(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
