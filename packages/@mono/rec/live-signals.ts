import type { Frame } from "./screencast";
import {
	type EventInput,
	type Signal,
	SignalDetector,
	type SignalInput,
} from "./signals";

/** What the control panel shows for one signal. */
export interface SignalRow {
	/** Wall-clock ms. */
	at: number;
	kind: Signal["signal"];
	title: string;
	detail: string;
	/** A JPEG of the page then, base64. */
	thumbnail?: string;
}

/**
 * Turns events and log lines into rows for the panel's list as they arrive.
 * Give it each event and log line; it calls `emit` with a row, a thumbnail of
 * the page from `frameAt` included, for every signal found. A dead click
 * shows up a few seconds after the click.
 */
export class LiveSignals {
	// The same detector the stop-time pass uses, so both give the same signals.
	private readonly detector = new SignalDetector();

	constructor(
		private readonly frameAt: (at: number) => Frame | undefined,
		private readonly emit: (row: SignalRow) => void,
	) {}

	event(event: EventInput): void {
		this.push({ kind: "event", event });
	}

	log(source: string, line: string): void {
		this.push({ kind: "log", source, line });
	}

	private push(input: SignalInput): void {
		for (const signal of this.detector.push(input)) {
			this.emit(signalRow(signal, this.frameAt(signal.at)));
		}
	}
}

const TITLES: Record<Signal["signal"], string> = {
	mark: "Remark",
	highlight: "Highlighted",
	"console-error": "Console error",
	exception: "Exception",
	"request-failed": "Request failed",
	"request-slow": "Slow request",
	"log-error": "Log error",
	"rage-click": "Rage click",
	"dead-click": "Click did nothing",
	retry: "Retry",
	"page-error": "Error on the page",
};

/** A short line on what the signal is about. */
function detailOf(signal: Signal): string {
	const detail = signal.detail;
	const pick = (...keys: string[]): string => {
		for (const key of keys) {
			const value = detail[key];
			if (typeof value === "string" && value !== "") {
				return value;
			}
		}
		return "";
	};
	switch (signal.signal) {
		case "request-failed":
			return `${pick("request")} · ${pick("status")}`;
		case "request-slow":
			return `${pick("request")} · ${Math.round(Number(detail.ms) / 100) / 10}s`;
		case "rage-click":
			return `${pick("element")} × ${String(detail.clicks)}`;
		case "highlight":
			return "Pointed out with the laser";
		default:
			return pick("text", "label", "element", "request", "action", "kind");
	}
}

export function signalRow(signal: Signal, frame?: Frame): SignalRow {
	return {
		at: signal.at,
		kind: signal.signal,
		title: TITLES[signal.signal],
		detail: detailOf(signal).slice(0, 120),
		thumbnail: frame ? Buffer.from(frame.jpeg).toString("base64") : undefined,
	};
}
