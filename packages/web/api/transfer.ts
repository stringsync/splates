import { ApiError, scoped, send } from "./request";

/** Where the export downloads from, without the conversations unless `conversations`. */
export function exportUrl(conversations: boolean): string {
	return scoped(`/api/config/export${conversations ? "" : "?conversations=0"}`);
}

/** Sends part `part` of export upload `upload`, the first starting it over. */
export async function uploadPart(
	upload: string,
	part: number,
	text: string,
): Promise<void> {
	await send(
		`/api/config/import/parts?${new URLSearchParams({ upload, part: String(part) })}`,
		{ headers: { "content-type": "text/plain" }, body: text },
	);
}

/** What an import did, or the files here it stopped on. */
export type Imported =
	| { written: string[]; kept: string[]; asked: string[] }
	| { conflicts: string[] };

/** Imports `upload`, overwriting files here that differ only when `force`. */
export async function importConfig(
	upload: string,
	force: boolean,
): Promise<Imported> {
	const response = await fetch(scoped("/api/config/import"), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ upload, force }),
	});
	const body = (await response.json().catch(() => ({}))) as {
		reason?: string;
		message?: string;
		written?: string[];
		kept?: string[];
		asked?: string[];
		conflicts?: string[];
	};
	if (response.status === 409 && body.conflicts !== undefined) {
		return { conflicts: body.conflicts };
	}
	if (!response.ok) {
		throw new ApiError(
			body.reason ?? "error",
			body.message ?? `/api/config/import: ${response.status}`,
		);
	}
	return {
		written: body.written ?? [],
		kept: body.kept ?? [],
		asked: body.asked ?? [],
	};
}
