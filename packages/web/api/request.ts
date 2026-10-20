export class ApiError extends Error {
	constructor(
		readonly reason: string,
		message: string,
	) {
		super(message);
	}
}

/**
 * `path` for the project this page shows: the one `?project=` names, or none
 * for the one `splates server` started in, unless `path` names one itself.
 * Given `project`, a slug, for that one instead, as for something of
 * another project's on this page. Every request the page makes goes
 * through here.
 */
export function scoped(path: string, project: string | null = null): string {
	const named = project ?? new URLSearchParams(location.search).get("project");
	if (named === null || named === "" || path.includes("project=")) {
		return path;
	}
	const query = new URLSearchParams({ project: named });
	return `${path}${path.includes("?") ? "&" : "?"}${query}`;
}

/**
 * POSTs to `path` for this project, or as `init` says, answering with the
 * body, or throwing the refusal as an `ApiError`.
 */
export async function send(path: string, init: RequestInit): Promise<unknown> {
	const response = await fetch(scoped(path), { method: "POST", ...init });
	const body = (await response.json().catch(() => ({}))) as {
		reason?: string;
		message?: string;
	};
	if (!response.ok) {
		throw new ApiError(
			body.reason ?? "error",
			body.message ??
				(response.status === 413
					? "too big to send"
					: `${path}: ${response.status}`),
		);
	}
	return body;
}

/** `send` with `body` as JSON, by `method`. */
export function sendJson(path: string, method: string, body: unknown) {
	return send(path, {
		method,
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}
