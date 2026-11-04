import type {
	RecOpen,
	RecSessionDetail,
	RecSessionMatch,
	RecSessions,
	RecState,
} from "@splates/server/rec/browser";
import { ApiError, answered, send, sendJson } from "./request";

/** Whether rec is there, what it is doing and what it could follow. */
export async function recState(): Promise<RecState> {
	const response = await answered("/api/rec");
	if (!response.ok) {
		throw new ApiError("error", `/api/rec: ${response.status}`);
	}
	return (await response.json()) as RecState;
}

/** A session name rec has not used. */
export async function recName(): Promise<string> {
	const response = await answered("/api/rec/name");
	if (!response.ok) {
		throw new ApiError("error", `/api/rec/name: ${response.status}`);
	}
	return ((await response.json()) as { name: string }).name;
}

/** Has the server open rec's Chrome on its machine. */
export async function openRec(what: RecOpen): Promise<void> {
	await sendJson("/api/rec/open", "POST", what);
}

const sessionPath = (name: string) =>
	`/api/rec/sessions/${encodeURIComponent(name)}`;

async function readJson<T>(path: string): Promise<T> {
	const response = await answered(path);
	if (!response.ok) {
		throw new ApiError("error", `${path}: ${response.status}`);
	}
	return (await response.json()) as T;
}

/** Every saved session and how full rec's store is. */
export function recSessions(): Promise<RecSessions> {
	return readJson("/api/rec/sessions");
}

/** The sessions whose name or spoken lines hold `query`. */
export function searchRecSessions(query: string): Promise<RecSessionMatch[]> {
	return readJson(`/api/rec/sessions/search?q=${encodeURIComponent(query)}`);
}

/** One session with its moments and files. */
export function recSession(name: string): Promise<RecSessionDetail> {
	return readJson(sessionPath(name));
}

/** Where a session's recording plays from. */
export const recVideoUrl = (name: string): string =>
	`${sessionPath(name)}/video`;

/** Where a still (`still`) or a log (`log`) of a session is served. */
export const recFileUrl = (
	name: string,
	kind: "still" | "log",
	file: string,
): string => `${sessionPath(name)}/${kind}/${encodeURIComponent(file)}`;

/** A log of a session, as text. */
export async function recLog(name: string, file: string): Promise<string> {
	const response = await answered(recFileUrl(name, "log", file));
	if (!response.ok) {
		throw new ApiError("error", `log ${file}: ${response.status}`);
	}
	return response.text();
}

export async function renameRecSession(
	name: string,
	to: string,
): Promise<void> {
	await sendJson(`${sessionPath(name)}/rename`, "POST", { to });
}

export async function deleteRecSession(name: string): Promise<void> {
	await send(sessionPath(name), { method: "DELETE" });
}

export async function openRecFolder(name: string): Promise<void> {
	await sendJson(`${sessionPath(name)}/open-folder`, "POST", {});
}
