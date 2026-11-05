/**
 * Code signals: the moments in a session worth an agent's look that need no
 * speech to find (marks, highlights, errors, failed and slow requests, rage
 * and dead clicks, retries, error text on the page). Feed a `SignalDetector`
 * events and log lines as they arrive, or call `detectSignals` on a finished
 * session; each signal keeps its raw facts and no weight.
 */

export class SignalDetector {
	private newest = 0;
	private clicks: Click[] = [];
	private requests: { at: number; key: string; failed: boolean }[] = [];
	private routes: { at: number; url: string }[] = [];
	private dead: Dead[] = [];
	private rageUntil = new Map<string, number>();
	private retried = new Map<string, number>();

	/** Takes one input; returns the signals it completes. */
	push(input: SignalInput): Signal[] {
		const out: Signal[] = [];
		if (input.kind === "event") {
			this.event(input.event, out);
		} else {
			this.log(input.source, input.line, out);
		}
		this.settle(out, false);
		return out;
	}

	/** Decides what is still waiting, at the end of a session. */
	flush(): Signal[] {
		const out: Signal[] = [];
		this.settle(out, true);
		return out;
	}

	private advance(at: number): void {
		this.newest = Math.max(this.newest, at);
		const floor = this.newest - WINDOW_MS;
		this.clicks = this.clicks.filter((item) => item.at >= floor);
		this.requests = this.requests.filter((item) => item.at >= floor);
		this.routes = this.routes.filter((item) => item.at >= floor);
	}

	private event(event: EventInput, out: Signal[]): void {
		this.advance(event.at);
		switch (event.type) {
			case "mark":
				out.push({
					at: event.at,
					signal: "mark",
					source: "events",
					detail: { label: event.label, still: event.still },
				});
				return;
			case "highlight":
				out.push({
					at: event.at,
					signal: "highlight",
					source: "events",
					detail: { area: event.area, still: event.still },
				});
				return;
			case "alert":
				out.push({
					at: event.at,
					signal: "page-error",
					source: "events",
					detail: { kind: event.kind, text: event.text },
				});
				return;
			case "quiet":
				this.dead.push({ at: event.at, event });
				return;
			case "route":
				this.route(event, out);
				return;
			case "click":
				this.click(event, out);
				return;
		}
	}

	private click(event: EventInput, out: Signal[]): void {
		const key = label(event);
		this.clicks.push({ at: event.at, key, event });
		const same = this.clicks.filter((item) => item.key === key);
		const burst = same.filter((item) => item.at > event.at - RAGE_MS);
		if (
			burst.length >= RAGE_CLICKS &&
			event.at >= (this.rageUntil.get(key) ?? 0)
		) {
			this.rageUntil.set(key, event.at + RETRY_MS);
			out.push({
				at: burst[0]?.at ?? event.at,
				signal: "rage-click",
				source: "events",
				detail: {
					element: key,
					selector: event.selector,
					clicks: burst.length,
					still: event.still,
				},
			});
			return;
		}
		const spread = same.filter((item) => item.at > event.at - RETRY_MS);
		if (
			spread.length >= RETRY_CLICKS &&
			event.at >= (this.rageUntil.get(key) ?? 0) &&
			event.at >= (this.retried.get(key) ?? 0)
		) {
			this.retried.set(key, event.at + RETRY_MS);
			out.push({
				at: spread[0]?.at ?? event.at,
				signal: "retry",
				source: "events",
				detail: { action: "click", element: key, times: spread.length },
			});
		}
	}

	private route(event: EventInput, out: Signal[]): void {
		const url = event.url ?? "";
		const back = this.routes.at(-2);
		const last = this.routes.at(-1);
		this.routes.push({ at: event.at, url });
		if (
			back &&
			last &&
			back.url === url &&
			last.url !== url &&
			event.at - back.at <= BOUNCE_MS
		) {
			out.push({
				at: back.at,
				signal: "retry",
				source: "events",
				detail: { action: "navigation", between: [url, last.url] },
			});
		}
	}

	private log(source: string, line: string, out: Signal[]): void {
		const parts = parseLog(line);
		if (!parts) {
			return;
		}
		this.advance(parts.at);
		const error = parts.level === "ERROR" || parts.level === "EXCEPTION";
		if (source.endsWith("network.log")) {
			const request = parseRequest(parts.text);
			if (!request) {
				return;
			}
			const failed = parts.level === "ERROR";
			const key = `${request.method} ${request.path}`;
			const text = parts.text;
			if (failed) {
				out.push({
					at: parts.at,
					signal: "request-failed",
					source,
					detail: { request: key, status: request.status, ms: request.ms },
				});
				const again = this.requests.filter(
					(item) =>
						item.key === key && item.failed && item.at >= parts.at - RETRY_MS,
				).length;
				if (again === 1) {
					out.push({
						at: parts.at,
						signal: "retry",
						source,
						detail: { action: "request", request: key, status: request.status },
					});
				}
			} else if (request.ms >= SLOW_MS) {
				out.push({
					at: parts.at,
					signal: "request-slow",
					source,
					detail: { request: key, ms: request.ms, line: text },
				});
			}
			this.requests.push({ at: parts.at, key, failed });
			return;
		}
		if (!error) {
			return;
		}
		out.push({
			at: parts.at,
			signal: source.endsWith("console.log")
				? parts.level === "EXCEPTION"
					? "exception"
					: "console-error"
				: "log-error",
			source,
			detail: { text: parts.text.slice(0, 300) },
		});
	}

	/** Dead-click candidates no request can explain any more. */
	private settle(out: Signal[], all: boolean): void {
		const keep: Dead[] = [];
		for (const item of this.dead) {
			if (!all && this.newest < item.at + DEAD_MS + DEAD_GRACE_MS) {
				keep.push(item);
				continue;
			}
			const asked = this.requests.some(
				(request) =>
					request.at >= item.at - 50 && request.at <= item.at + DEAD_MS,
			);
			const moved = this.routes.some(
				(route) => route.at >= item.at && route.at <= item.at + DEAD_MS,
			);
			if (!asked && !moved) {
				out.push({
					at: item.at,
					signal: "dead-click",
					source: "events",
					detail: {
						element: label(item.event),
						selector: item.event.selector,
						text: item.event.text,
					},
				});
			}
		}
		this.dead = keep;
	}
}

/** The file the signals of a session go to, one JSON object per line. */
export const MOMENTS_JSONL = "moments.jsonl";

/** Inputs older than this, against the newest seen, are dropped from the window. */
export const WINDOW_MS = 30_000;
/** Clicks on one element within this are a rage click when there are `RAGE_CLICKS` of them. */
export const RAGE_MS = 1000;
export const RAGE_CLICKS = 3;
/** A click that changes nothing within this is dead. The page script waits this long to say so. */
export const DEAD_MS = 500;
/** How long the same action repeated counts as a retry. */
export const RETRY_MS = 15_000;
export const RETRY_CLICKS = 3;
/** A request slower than this is a signal. */
export const SLOW_MS = 3000;
/** A back-and-forth between two routes within this is a signal. */
export const BOUNCE_MS = 10_000;
/** How long past a dead-click candidate the stream must go before no request can still explain it. */
const DEAD_GRACE_MS = 5000;

export type SignalKind =
	| "mark"
	| "highlight"
	| "console-error"
	| "exception"
	| "request-failed"
	| "request-slow"
	| "log-error"
	| "rage-click"
	| "dead-click"
	| "retry"
	| "page-error";

/** One line of `moments.jsonl`: when (wall-clock ms), what, from where, and the raw facts. */
export interface Signal {
	at: number;
	signal: SignalKind;
	/** The log file or `events` the facts came from. */
	source: string;
	detail: Record<string, unknown>;
}

/** What the page script and the control window put in `events.jsonl`, as far as detection reads it. */
export interface EventInput {
	at: number;
	type: string;
	component?: string;
	selector?: string;
	text?: string;
	url?: string;
	still?: string;
	area?: number[];
	kind?: string;
	label?: string;
}

export type SignalInput =
	| { kind: "event"; event: EventInput }
	| { kind: "log"; source: string; line: string };

interface Click {
	at: number;
	key: string;
	event: EventInput;
}

interface Dead {
	at: number;
	event: EventInput;
}

interface LogParts {
	at: number;
	level: string;
	text: string;
}

function parseLog(line: string): LogParts | undefined {
	const match = /^(\S+)\s+(\w+)\s*(.*)$/.exec(line);
	const at = match ? Date.parse(match[1] as string) : Number.NaN;
	if (!match || Number.isNaN(at)) {
		return undefined;
	}
	return {
		at,
		level: (match[2] as string).toUpperCase(),
		text: match[3] ?? "",
	};
}

/** A network summary line's parts: `METHOD host/path status NNNms size type`. */
function parseRequest(
	text: string,
): { method: string; path: string; status: string; ms: number } | undefined {
	const match = /^([A-Z]+) (\S+) (\S+) (\d+)ms\b/.exec(text);
	return match
		? {
				method: match[1] as string,
				path: match[2] as string,
				status: match[3] as string,
				ms: Number(match[4]),
			}
		: undefined;
}

const label = (item: {
	component?: string;
	selector?: string;
	text?: string;
}): string => item.component ?? item.selector ?? item.text ?? "unknown";

/** Runs the detector over a finished session's files: `events.jsonl` and each log's text, as {name, text}. */
export function detectSignals(
	eventsText: string,
	logs: { source: string; text: string }[],
	startedAt: number,
): Signal[] {
	const inputs: { at: number; input: SignalInput }[] = [];
	for (const line of eventsText.split("\n")) {
		if (!line.trim()) {
			continue;
		}
		try {
			const event = JSON.parse(line) as EventInput;
			if (event.at >= startedAt) {
				inputs.push({ at: event.at, input: { kind: "event", event } });
			}
		} catch {
			// A torn last line.
		}
	}
	for (const { source, text } of logs) {
		for (const line of text.split("\n")) {
			const parts = parseLog(line);
			if (parts && parts.at >= startedAt) {
				inputs.push({ at: parts.at, input: { kind: "log", source, line } });
			}
		}
	}
	inputs.sort((left, right) => left.at - right.at);
	const detector = new SignalDetector();
	const out = inputs.flatMap((item) => detector.push(item.input));
	out.push(...detector.flush());
	return out.sort((left, right) => left.at - right.at);
}

export function renderSignals(signals: Signal[]): string {
	return signals.map((signal) => `${JSON.stringify(signal)}\n`).join("");
}
