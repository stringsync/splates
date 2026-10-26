import { aborts } from "webappwiz/abort";
import { Duration } from "webappwiz/time";

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
 * How long the page waits on the server's answer to one request before it
 * gives up on it, so no read or action waits for good. A test shortens them.
 */
export const WAITS = {
	/** For any request the server answers at once, or nearly. */
	answer: Duration.secs(30),
	/** For one that sends files, which a slow connection takes a while to carry. */
	upload: Duration.mins(5),
};

/** What `answered` takes beyond `fetch`'s own: how long to wait. */
export interface Answering extends RequestInit {
	/** How long the server has to answer; `WAITS.answer` unless given. */
	within?: Duration;
}

/**
 * `fetch`, given up on once the server takes longer than `within` to answer,
 * as an `ApiError` with reason `timeout`, so a caller says so beside the
 * control rather than spinning on. Every request the page awaits comes
 * through here.
 */
export async function answered(
	input: string,
	{ within = WAITS.answer, signal, ...init }: Answering = {},
): Promise<Response> {
	using timeout = expiring(within);
	try {
		return await fetch(input, {
			...init,
			signal: signal
				? AbortSignal.any([signal, timeout.signal])
				: timeout.signal,
		});
	} catch (error) {
		throw timedOut(error, timeout.signal, within);
	}
}

/**
 * A signal aborted with a `TimeoutError`, as `AbortSignal.timeout`'s is, once
 * `within` has passed, unless disposed first: `using timeout = expiring(wait)`
 * around the work, and `timeout.signal` to what should give up.
 */
export function expiring(
	within: Duration,
): { readonly signal: AbortSignal } & Disposable {
	// `AbortSignal.timeout`'s own timer runs on after the answer, holding its
	// signal, the request and whatever awaited it until it fires: in a worker
	// of the page's tests, which make thousands of requests a minute, that
	// kept 30 s of tests' pages alive.
	const controller = new AbortController();
	const timer = setTimeout(
		() =>
			controller.abort(new DOMException("signal timed out", "TimeoutError")),
		within.ms,
	);
	return {
		signal: controller.signal,
		[Symbol.dispose]: () => clearTimeout(timer),
	};
}

/**
 * `waiting`, as `answered` gives up on a request, for one the page did not
 * start itself and so cannot abort, such as a read index.html began.
 */
export async function answeredFrom(
	waiting: Promise<Response>,
	within: Duration = WAITS.answer,
): Promise<Response> {
	using timeout = expiring(within);
	try {
		return await aborts.race(timeout.signal, waiting);
	} catch (error) {
		throw timedOut(error, timeout.signal, within);
	}
}

/** `error`, or the timeout's own `ApiError` when `timeout` caused it. */
function timedOut(error: unknown, timeout: AbortSignal, within: Duration) {
	return timeout.aborted
		? new ApiError("timeout", `no answer in ${seconds(within)}`)
		: error;
}

/** `within` as the page says it: "30s", or "5m" from a minute on. */
function seconds(within: Duration): string {
	if (within.ms < 1000) {
		return `${within.ms}ms`;
	}
	const secs = Math.round(within.ms / 1000);
	return secs >= 60 && secs % 60 === 0 ? `${secs / 60}m` : `${secs}s`;
}

/**
 * POSTs to `path` for this project, or as `init` says, answering with the
 * body, or throwing the refusal as an `ApiError`.
 */
export async function send(path: string, init: Answering): Promise<unknown> {
	const response = await answered(scoped(path), {
		method: "POST",
		within: init.body instanceof FormData ? WAITS.upload : WAITS.answer,
		...init,
	});
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
export function sendJson(
	path: string,
	method: string,
	body: unknown,
	/** How long the server has to answer, for an action that takes it a while. */
	within?: Duration,
) {
	return send(path, {
		method,
		...(within === undefined ? {} : { within }),
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}
