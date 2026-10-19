import type {
	AutoPickRules,
	AutoPickRulesView,
	AutoPickTrial,
} from "@stringsync/splates-server/auto-pick";
import { ApiError, sendJson } from "./api";

/** This machine's Auto pick rules, and the agents a pick can name. */
export async function autoPickRules(): Promise<AutoPickRulesView> {
	const response = await fetch("/api/auto-pick/rules");
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
