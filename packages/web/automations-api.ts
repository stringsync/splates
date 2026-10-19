import type {
	AutomationRow,
	Hook,
	Trigger,
} from "@stringsync/splates-server/hooks";
import { ApiError, scoped, send, sendJson } from "./api";

/** Every automation set for this project, the checked-in ones too. */
export async function automations(): Promise<AutomationRow[]> {
	const response = await fetch(scoped("/api/automations"));
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
): Promise<AutomationRow[]> {
	return rows(await sendJson("/api/automations", "POST", { trigger, hook }));
}

/** Sets what the person's automation `id` runs on and runs, answering with every automation. */
export async function editAutomation(
	id: string,
	trigger: Trigger,
	hook: Hook,
): Promise<AutomationRow[]> {
	return rows(
		await sendJson(`/api/automations/${id}`, "PUT", { trigger, hook }),
	);
}

/** Takes away the person's automation `id`. */
export async function removeAutomation(id: string): Promise<AutomationRow[]> {
	return rows(await send(`/api/automations/${id}`, { method: "DELETE" }));
}

/** Pauses the person's automation `id`, or with false, lets it run again. */
export async function pauseAutomation(
	id: string,
	paused: boolean,
): Promise<AutomationRow[]> {
	return rows(
		await send(`/api/automations/${id}/pause`, {
			method: paused ? "PUT" : "DELETE",
		}),
	);
}

function rows(body: unknown): AutomationRow[] {
	return (body as { automations: AutomationRow[] }).automations;
}
