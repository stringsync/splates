import type { AgentQueueSettings } from "@splates/server/queue/browser";
import { ApiError, answered, scoped, sendJson } from "./request";

/** This project's server-saved agent auto-queue settings. */
export async function readAgentSettings(): Promise<AgentQueueSettings> {
	const response = await answered(scoped("/api/agent-settings"));
	if (!response.ok) {
		throw new ApiError("error", `/api/agent-settings: ${response.status}`);
	}
	return (await response.json()) as AgentQueueSettings;
}

/** Saves changes to this project's agent auto-queue settings on the server. */
export async function saveAgentSettings(
	patch: Partial<AgentQueueSettings>,
): Promise<AgentQueueSettings> {
	return (await sendJson(
		"/api/agent-settings",
		"PUT",
		patch,
	)) as AgentQueueSettings;
}
