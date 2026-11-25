import type { AutomationRow, Hook, Trigger } from "@splates/server/hooks";
import { ApiError, answered, scoped, send, sendJson } from "./api";

/** Every automation set for this project, the checked-in ones too. */
export async function automations(
	project: string | null = null,
): Promise<AutomationRow[]> {
	const response = await answered(scoped("/api/automations", project));
	const body = (await response.json().catch(() => ({}))) as {
		automations?: AutomationRow[];
		reason?: string;
		message?: string;
	};
	if (!response.ok || body.automations === undefined) {
		throw new ApiError(
			body.reason ?? "error",
			body.message ?? `/api/automations: ${response.status}`,
		);
	}
	return body.automations;
}

/** Adds one of `hook` on `trigger`, answering with every automation. */
export async function addAutomation(
	trigger: Trigger,
	hook: Hook,
	name = "",
	project: string | null = null,
): Promise<AutomationRow[]> {
	return rows(
		await sendJson(scoped("/api/automations", project), "POST", {
			trigger,
			hook,
			name,
		}),
	);
}

/** Sets what the person's automation `id` runs on and runs, answering with every automation. */
export async function editAutomation(
	id: string,
	trigger: Trigger,
	hook: Hook,
	name = "",
	project: string | null = null,
): Promise<AutomationRow[]> {
	return rows(
		await sendJson(scoped(`/api/automations/${id}`, project), "PUT", {
			trigger,
			hook,
			name,
		}),
	);
}

/** Takes away the person's automation `id`. */
export async function removeAutomation(
	id: string,
	project: string | null = null,
): Promise<AutomationRow[]> {
	return rows(
		await send(scoped(`/api/automations/${id}`, project), {
			method: "DELETE",
		}),
	);
}

/** Pauses the person's automation `id`, or with false, lets it run again. */
export async function pauseAutomation(
	id: string,
	paused: boolean,
	project: string | null = null,
): Promise<AutomationRow[]> {
	return rows(
		await send(scoped(`/api/automations/${id}/pause`, project), {
			method: paused ? "PUT" : "DELETE",
		}),
	);
}

/** Runs automation `id` now, answering once it started, its run listed. */
export async function runAutomation(
	id: string,
	project: string | null = null,
): Promise<AutomationRow[]> {
	return rows(
		await send(scoped(`/api/automations/${id}/run`, project), {
			method: "POST",
		}),
	);
}

function rows(body: unknown): AutomationRow[] {
	return (body as { automations: AutomationRow[] }).automations;
}
