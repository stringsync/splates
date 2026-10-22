import type {
	AutoPickRules,
	AutoPickRulesView,
	AutoPickTrial,
} from "@stringsync/splates-server/auto-pick";
import type { RuleOverrides } from "@stringsync/splates-server/stats/browser";
import { ApiError, answered, sendJson } from "./api";

/** How often the person overrode each rule's pick, across this machine's projects. */
export async function autoPickOverrides(): Promise<RuleOverrides[]> {
	const response = await answered("/api/auto-pick/overrides");
	if (!response.ok) {
		throw new ApiError("error", `/api/auto-pick/overrides: ${response.status}`);
	}
	return (await response.json()) as RuleOverrides[];
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
