import type { LaserShape } from "./pointer";
import type { Frame } from "./screencast";
import {
	type EventInput,
	type Signal,
	SignalDetector,
	type SignalInput,
} from "./signals";
import type { FrameSource, SignalRows } from "./sinks";

/** What the control panel shows for one signal. */
export interface SignalRow {
	/** Wall-clock ms. */
	at: number;
	kind: Signal["signal"];
	title: string;
	detail: string;
	/** For highlight rows: which annotation shape was drawn. */
	shape?: LaserShape;
	/** A JPEG of the page then, base64. */
	thumbnail?: string;
}

/**
 * Turns events and log lines into rows for the panel's list as they arrive.
 * Give it each event and log line; it gives `rows` a row with a thumbnail of
 * the page from `frames` included, for every signal found. A dead click
 * shows up a few seconds after the click.
 */
export class LiveSignals {
	// The same detector the stop-time pass uses, so both give the same signals.
	private readonly detector = new SignalDetector();

	constructor(
		private readonly frames: FrameSource,
		private readonly rows: SignalRows,
	) {}

	event(event: EventInput): void {
		this.push({ kind: "event", event });
	}

	log(source: string, line: string): void {
		this.push({ kind: "log", source, line });
	}

	private push(input: SignalInput): void {
		for (const signal of this.detector.push(input)) {
			this.rows.row(signalRow(signal, this.frames.frameAt(signal.at)));
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
		case "highlight": {
			const shape = shapeOf(signal);
			const element = pick("element");
			const area = Array.isArray(detail.area)
				? (detail.area as number[])
				: undefined;
			const size =
				area && area.length >= 4 && area[2] && area[3]
					? `${Math.round(area[2])}×${Math.round(area[3])}`
					: "";
			if (shape === "box") {
				if (element && size) {
					return `${element} · ${size}`;
				}
				return element || (size ? `${size} region` : "Boxed region");
			}
			if (shape === "arrow") {
				return element ? `Pointed at ${element}` : "Pointed with arrow";
			}
			return "Pointed out with the laser";
		}
		default:
			return pick("text", "label", "element", "request", "action", "kind");
	}
}

function shapeOf(signal: Signal): LaserShape | undefined {
	return signal.detail.shape === "arrow" || signal.detail.shape === "box"
		? signal.detail.shape
		: undefined;
}

function titleOf(signal: Signal): string {
	if (signal.signal === "highlight") {
		const shape = shapeOf(signal);
		if (shape === "box") {
			return "Boxed";
		}
		if (shape === "arrow") {
			return "Arrow";
		}
	}
	return TITLES[signal.signal];
}

export function signalRow(signal: Signal, frame?: Frame): SignalRow {
	const shape = signal.signal === "highlight" ? shapeOf(signal) : undefined;
	return {
		at: signal.at,
		kind: signal.signal,
		title: titleOf(signal),
		detail: detailOf(signal).slice(0, 120),
		...(shape ? { shape } : {}),
		thumbnail: frame ? Buffer.from(frame.jpeg).toString("base64") : undefined,
	};
}
