import type {
	AutoPickRules,
	AutoPickRulesView,
	AutoPickTrial,
	Avoided,
} from "@splates/server/auto-pick";
import type {
	CellOverrides,
	LineupOverrides,
	PeriodId,
	ScorecardRow,
} from "@splates/server/stats/browser";
import { ApiError, answered, sendJson } from "./api";

export interface AutoPickScores {
	minimumTasks: number;
	rows: ScorecardRow[];
	overrides: LineupOverrides[];
}

export async function autoPickScores(
	period: PeriodId,
): Promise<AutoPickScores> {
	const response = await answered(`/api/auto-pick/scorecard?period=${period}`);
	if (!response.ok) {
		throw new ApiError(
			"error",
			`Could not read the scorecard (${response.status})`,
		);
	}
	const scores = (await response.json()) as Partial<AutoPickScores> | null;
	if (
		!Array.isArray(scores?.rows) ||
		!Array.isArray(scores.overrides) ||
		typeof scores.minimumTasks !== "number"
	) {
		throw new ApiError("error", "The server returned an invalid scorecard");
	}
	return {
		rows: scores.rows,
		overrides: scores.overrides,
		minimumTasks: scores.minimumTasks,
	};
}

/** How often the person overrode each rule's pick, across this machine's projects. */
export async function autoPickOverrides(): Promise<{
	rows: CellOverrides[];
	cursor: number;
}> {
	const response = await answered("/api/auto-pick/overrides?view=notice");
	if (!response.ok) {
		throw new ApiError("error", `/api/auto-pick/overrides: ${response.status}`);
	}
	return {
		rows: (await response.json()) as CellOverrides[],
		cursor: Number(response.headers.get("X-Override-Cursor")),
	};
}

export async function dismissAutoPickOverrides(cursor: number): Promise<void> {
	await sendJson("/api/auto-pick/overrides/dismiss", "POST", { cursor });
}

/** Sends flagged scorecard cells to an agent as one board task, answering its number. */
export async function sendAutoPickOverrides(): Promise<number> {
	const body = (await sendJson(
		"/api/auto-pick/overrides/send",
		"POST",
		{},
	)) as {
		task: number;
	};
	return body.task;
}

/** This machine's Auto pick rules, and the agents a pick can name. */
export async function autoPickRules(): Promise<AutoPickRulesView> {
	const response = await answered("/api/auto-pick/rules");
	const body = (await response.json().catch(() => ({}))) as {
		reason?: string;
		message?: string;
	};
	if (!response.ok) {
		throw new ApiError(
			body.reason ?? "error",
			body.message ?? `/api/auto-pick/rules: ${response.status}`,
		);
	}
	return body as AutoPickRulesView;
}

/** Saves `rules` for this machine, throwing the server's refusal when they do not check out. */
export async function saveAutoPickRules(
	rules: AutoPickRules,
): Promise<AutoPickRulesView> {
	return (await sendJson("/api/auto-pick/rules", "PUT", {
		rules,
	})) as AutoPickRulesView;
}

/** Writes the default rules over this machine's. */
export async function resetAutoPickRules(): Promise<AutoPickRulesView> {
	return (await sendJson(
		"/api/auto-pick/rules/reset",
		"POST",
		{},
	)) as AutoPickRulesView;
}

/** What Auto pick would do for a task, starting nothing. */
export async function tryAutoPick(
	target: { task: string } | { todo: number },
): Promise<AutoPickTrial> {
	return (await sendJson(
		"/api/auto-pick/try",
		"POST",
		target,
	)) as AutoPickTrial;
}

/** The models Auto pick is passing over now, and why. */
export async function autoPickAvoided(): Promise<Avoided[]> {
	const response = await answered("/api/auto-pick/avoided");
	if (!response.ok) {
		throw new ApiError("error", `/api/auto-pick/avoided: ${response.status}`);
	}
	return (await response.json()) as Avoided[];
}

/** Tries `model` of `agent` at once ("Use anyway"), answering what is still avoided. */
export async function clearAvoided(
	agent: string,
	model: string | null,
): Promise<Avoided[]> {
	return (await sendJson("/api/auto-pick/avoided/clear", "POST", {
		agent,
		model,
	})) as Avoided[];
}

/** How many lineups Auto pick could route easier, and the key that dismisses them. */
export interface AutoPickImprovements {
	count: number;
	key: string;
}

export async function autoPickImprovements(): Promise<AutoPickImprovements> {
	const response = await answered("/api/auto-pick/improvements");
	if (!response.ok) {
		throw new ApiError(
			"error",
			`/api/auto-pick/improvements: ${response.status}`,
		);
	}
	const body = (await response.json()) as Partial<AutoPickImprovements> | null;
	if (typeof body?.count !== "number" || typeof body.key !== "string") {
		throw new ApiError("error", "The server returned invalid improvements");
	}
	return { count: body.count, key: body.key };
}

export async function dismissAutoPickImprovements(key: string): Promise<void> {
	await sendJson("/api/auto-pick/improvements/dismiss", "POST", { key });
}

/** Sends the possible improvements to an agent as one board task, answering its number. */
export async function sendAutoPickImprovements(): Promise<number> {
	const body = (await sendJson(
		"/api/auto-pick/improvements/send",
		"POST",
		{},
	)) as { task: number };
	return body.task;
}
