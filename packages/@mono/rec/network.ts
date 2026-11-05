import { logLine } from "./log-lines";

/**
 * A request as host and path, query values redacted and the fragment dropped:
 * which fields a request carried is useful, what they held is not kept.
 */
export function redactUrl(url: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return url.slice(0, 80);
	}
	if (parsed.protocol === "data:" || parsed.protocol === "blob:") {
		return `${parsed.protocol}…`;
	}
	const keys = [...parsed.searchParams.keys()];
	const query =
		keys.length > 0 ? `?${keys.map((k) => `${k}=_`).join("&")}` : "";
	return `${parsed.host}${parsed.pathname}${query}`;
}

function size(bytes: number): string {
	return bytes < 1024 ? `${bytes}B` : `${(bytes / 1024).toFixed(1)}kB`;
}

interface Request {
	method: string;
	url: string;
	/** Wall-clock ms of the request. */
	at: number;
	/** Chrome's monotonic seconds at the request. */
	started: number;
	status?: number;
	type?: string;
}

/**
 * Folds a page's network events into one summary line per request: method,
 * address, status, time, size and content type. Never headers or bodies.
 */
export class NetworkSummary {
	private readonly requests = new Map<string, Request>();

	/** Returns a line once a request has finished or failed. */
	receive(method: string, params: Record<string, unknown>): string | undefined {
		const id = String(params.requestId);
		switch (method) {
			case "Network.requestWillBeSent": {
				const request = params.request as { method: string; url: string };
				this.requests.set(id, {
					method: request.method,
					url: request.url,
					at: Number(params.wallTime) * 1000,
					started: Number(params.timestamp),
				});
				return undefined;
			}
			case "Network.responseReceived": {
				const request = this.requests.get(id);
				const response = params.response as {
					status: number;
					mimeType?: string;
				};
				if (request) {
					request.status = response.status;
					request.type = response.mimeType;
				}
				return undefined;
			}
			case "Network.loadingFinished": {
				const request = this.take(id);
				return request && this.line(request, params, "finished");
			}
			case "Network.loadingFailed": {
				const request = this.take(id);
				return (
					request &&
					this.line(request, params, String(params.errorText ?? "failed"))
				);
			}
		}
		return undefined;
	}

	private take(id: string): Request | undefined {
		const request = this.requests.get(id);
		this.requests.delete(id);
		return request;
	}

	private line(
		request: Request,
		params: Record<string, unknown>,
		outcome: string,
	): string {
		const elapsed = Math.round(
			(Number(params.timestamp) - request.started) * 1000,
		);
		const failed = outcome !== "finished";
		const level = failed || (request.status ?? 0) >= 400 ? "error" : "info";
		const bytes = Number(params.encodedDataLength ?? 0);
		const parts = [
			request.method,
			redactUrl(request.url),
			failed ? outcome : String(request.status ?? "-"),
			`${elapsed}ms`,
			size(bytes),
			request.type ?? "-",
		];
		return logLine(request.at, level, parts.join(" "));
	}
}
