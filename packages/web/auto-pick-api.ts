import type {
	AutoPickRules,
	AutoPickRulesView,
	AutoPickTrial,
	Avoided,
} from "@splates/server/auto-pick";
import type { CellOverrides } from "@splates/server/stats/browser";
import { ApiError, answered, sendJson } from "./api";

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

/** Sends the overrides to an agent as one board task, answering its number. */
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
