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

function groupOf(window: string): string {
	const index = window.indexOf(" · ");
	return index === -1 ? window : window.slice(0, index);
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
