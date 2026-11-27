import { Disposer, type Resource } from "core/disposable";
import type { Fs } from "core/system";
import { SystemTimer } from "core/time";
import type { Cdp, CdpEvent } from "./cdp";
import { redactUrl } from "./network";
import { PageSnapshots } from "./page-snapshot";
import { POINTER_BINDING, pointerSource } from "./pointer-script";
import type { Frame } from "./screencast";
import type { Scrubber } from "./scrub";
import type { PageFilter } from "./sinks";

/** The events file and the folder of stills, in the session folder. */
export const EVENTS_FILE = "events.jsonl";
export const FRAMES_DIR = "frames";

/** How long after a click or highlight to wait for the screencast to catch up before cutting its still. */
const STILL_DELAY_MS = 250;
/** A still shows the screen this long after the event, so a click's effect is in it. */
const STILL_AFTER_MS = 150;
/** Frames kept to cut stills from. */
const RING = 40;

/**
 * Turns what the page script sent into an event for `events.jsonl`: text is
 * scrubbed and a route's query values are redacted. Anything else is dropped.
 */
export function parseEvent(
	payload: string,
	scrub: Scrubber,
): PointerEvent | undefined {
	let raw: Record<string, unknown>;
	try {
		raw = JSON.parse(payload) as Record<string, unknown>;
	} catch {
		return undefined;
	}
	const at = num(raw.at);
	if (!at) {
		return undefined;
	}
	switch (raw.type) {
		case "move":
			return {
				at,
				type: "move",
				x: num(raw.x),
				y: num(raw.y),
				...cleanTarget(raw, scrub),
			};
		case "rest":
			return {
				at,
				type: "paused",
				x: num(raw.x),
				y: num(raw.y),
				...cleanTarget(raw, scrub),
			};
		case "click":
			return {
				at,
				type: "click",
				x: num(raw.x),
				y: num(raw.y),
				...cleanTarget(raw, scrub),
			};
		case "type":
			return { at, type: "type", ...cleanTarget(raw, scrub) };
		case "quiet":
			return { at, type: "quiet", ...cleanTarget(raw, scrub) };
		case "alert":
			return {
				at,
				type: "alert",
				kind: String(raw.kind),
				...cleanTarget(raw, scrub),
			};
		case "route":
			return {
				at,
				type: "route",
				url: scrub.scrub(redactUrl(String(raw.url))),
			};
		case "highlight": {
			const shape =
				raw.shape === "arrow" || raw.shape === "box" ? raw.shape : undefined;
			return {
				at,
				type: "highlight",
				...(shape ? { shape } : {}),
				...(Array.isArray(raw.from) ? { from: raw.from.map(Number) } : {}),
				...(Array.isArray(raw.to) ? { to: raw.to.map(Number) } : {}),
				path: Array.isArray(raw.path)
					? (raw.path as unknown[][]).map((point) => point.map(Number))
					: [],
				area: Array.isArray(raw.area) ? raw.area.map(Number) : [],
				elements: Array.isArray(raw.elements)
					? (raw.elements as Record<string, unknown>[]).map((item) =>
							cleanTarget(item, scrub),
						)
					: [],
			};
		}
		default:
			return undefined;
	}
}

/** Which shape the laser pointer draws in the page. */
export type LaserShape = "arrow" | "box";

/** Live state of the laser pointer in the working tab. */
export type LaserMode = "off" | LaserShape;

/** Whether the page script said its laser pointer is drawing an arrow, drawing a box, or off; undefined for anything else. */
export function parseLaser(payload: string): LaserMode | undefined {
	try {
		const raw = JSON.parse(payload) as Record<string, unknown>;
		if (raw.type !== "laser") {
			return undefined;
		}
		if (raw.on !== true) {
			return "off";
		}
		return raw.shape === "box" ? "box" : "arrow";
	} catch {
		return undefined;
	}
}

/** What the page script reports about the element under the pointer. */
export interface Target {
	component?: string;
	selector?: string;
	text?: string;
	/** x, y, width, height in CSS pixels. */
	box?: number[];
}

/** One line of `events.jsonl`. `at` is wall-clock ms. */
export type PointerEvent = { at: number } & (
	| ({ type: "move"; x: number; y: number } & Target)
	| ({ type: "paused"; x: number; y: number } & Target)
	| ({ type: "click"; x: number; y: number; still?: string } & Target)
	| ({ type: "type" } & Target)
	| ({ type: "quiet" } & Target)
	| ({ type: "alert"; kind: string } & Target)
	| { type: "route"; url: string }
	| {
			type: "snapshot";
			trigger: string;
			structure: string;
			sourceAt?: number;
			still?: string;
	  }
	| { type: "mark"; label: string; by: "agent" | "person"; still?: string }
	| {
			type: "highlight";
			shape?: LaserShape;
			from?: number[];
			to?: number[];
			path: number[][];
			area: number[];
			elements: Target[];
			still?: string;
	  }
);

const STRINGS = ["component", "selector", "text"] as const;

function cleanTarget(raw: Record<string, unknown>, scrub: Scrubber): Target {
	const out: Target = {};
	for (const key of STRINGS) {
		const value = raw[key];
		if (typeof value === "string" && value !== "") {
			out[key] = scrub.scrub(value);
		}
	}
	if (Array.isArray(raw.box)) {
		out.box = raw.box.map(Number);
	}
	return out;
}

const num = (value: unknown): number => Number(value) || 0;

/** The frame to use as the still for an event at `at`: the screen just after it, else the nearest. */
export function pickFrame(frames: Frame[], at: number): Frame | undefined {
	const target = at + STILL_AFTER_MS;
	let best: Frame | undefined;
	for (const frame of frames) {
		if (frame.at <= target && (!best || frame.at > best.at)) {
			best = frame;
		}
	}
	return (
		best ??
		frames.reduce<Frame | undefined>(
			(near, frame) =>
				!near || Math.abs(frame.at - at) < Math.abs(near.at - at)
					? frame
					: near,
			undefined,
		)
	);
}

export interface PointerOptions {
	cdp: Cdp;
	fs: Fs;
	/** The session folder. */
	dir: string;
	scrubber: Scrubber;
	/** Pages whose URL it matches get no script, such as the control window. */
	skip: PageFilter;
	/** Hears the laser and each event once it is written. */
	observer: PointerObserver;
}

/** What the pointer script reports, as it happens. */
export interface PointerObserver {
	/** Option or Option+Command changed in a page, starting or ending an arrow or box. */
	laser(mode: LaserMode): void;
	/** An event was written. */
	event(event: PointerEvent): void;
}

interface TargetInfo {
	targetId: string;
	type: string;
	url: string;
}

/**
 * Injects the pointer script into every page but the control window and
 * writes what it reports to `events.jsonl`, with a still from the screencast
 * for each click and highlight.
 */
export class PointerEvents implements Resource {
	private readonly disposer = new Disposer();
	private readonly attached = new Set<string>();
	private readonly frames: Frame[] = [];
	private readonly pending = new Set<Promise<void>>();
	private writing = Promise.resolve();
	private stills = 0;
	private readonly sessions = new Map<string, string>();
	private readonly snapshots: PageSnapshots;
	counts = { events: 0, stills: 0 };

	private constructor(private readonly opts: PointerOptions) {
		this.snapshots = this.disposer.use(
			new PageSnapshots({
				...opts,
				timer: new SystemTimer(),
				active: () => {
					const id = this.frames.at(-1)?.targetId;
					return id ? this.sessions.get(id) : undefined;
				},
				saved: (event, session) =>
					this.record(
						event,
						[...this.sessions].find(([, id]) => id === session)?.[0],
					),
			}),
		);
		this.disposer.use(opts.cdp.on(this.receive));
	}

	static async start(opts: PointerOptions): Promise<PointerEvents> {
		await opts.fs.mkdir(`${opts.dir}/${FRAMES_DIR}`, { recursive: true });
		const pointer = new PointerEvents(opts);
		await opts.cdp.send("Target.setDiscoverTargets", { discover: true });
		const { targetInfos } = await opts.cdp.send<{ targetInfos: TargetInfo[] }>(
			"Target.getTargets",
		);
		await Promise.all(targetInfos.map((info) => pointer.attach(info)));
		return pointer;
	}

	/** Gives the screencast's frames to cut stills from. */
	frame(frame: Frame): void {
		this.frames.push(frame);
		if (this.frames.length > RING) {
			this.frames.shift();
		}
	}

	/** The screencast frame nearest an event at `at`, if any is in the ring. */
	frameAt(at: number): Frame | undefined {
		return pickFrame(this.frames, at);
	}

	/** Writes an agent's remark as a `mark` event at `at`, with a still of the screen then. */
	mark(at: number, label: string, by: "agent" | "person" = "agent"): void {
		const id = this.frames.at(-1)?.targetId;
		const session = id ? this.sessions.get(id) : undefined;
		if (session) {
			this.snapshots.capture(session, "mark", at);
		}
		this.record({ at, type: "mark", label, by });
	}

	/** Resolves once every event seen so far, and its still, is on disk. */
	async flush(): Promise<void> {
		await this.snapshots.flush();
		await Promise.all([...this.pending]);
		await this.snapshots.flush();
		await Promise.all([...this.pending]);
		await this.writing;
	}

	dispose(): void {
		this.disposer.dispose();
	}

	private async attach(info: TargetInfo): Promise<void> {
		if (
			info.type !== "page" ||
			this.attached.has(info.targetId) ||
			this.opts.skip.skips(info.url)
		) {
			return;
		}
		this.attached.add(info.targetId);
		const { cdp } = this.opts;
		try {
			const { sessionId } = await cdp.send<{ sessionId: string }>(
				"Target.attachToTarget",
				{ targetId: info.targetId, flatten: true },
			);
			const source = pointerSource();
			this.sessions.set(info.targetId, sessionId);
			await cdp.send("Runtime.enable", {}, sessionId);
			await cdp.send(
				"Runtime.addBinding",
				{ name: POINTER_BINDING },
				sessionId,
			);
			await cdp.send("Page.enable", {}, sessionId);
			await cdp.send(
				"Page.addScriptToEvaluateOnNewDocument",
				{ source },
				sessionId,
			);
			await cdp.send("Runtime.evaluate", { expression: source }, sessionId);
		} catch {
			// The tab closed while it was being attached.
			this.attached.delete(info.targetId);
		}
	}

	private readonly receive = (event: CdpEvent): void => {
		const { method, params } = event;
		if (
			method === "Target.targetCreated" ||
			method === "Target.targetInfoChanged"
		) {
			void this.attach(params.targetInfo as TargetInfo);
			return;
		}
		if (method !== "Runtime.bindingCalled" || params.name !== POINTER_BINDING) {
			return;
		}
		const payload = String(params.payload);
		const laser = parseLaser(payload);
		if (laser !== undefined) {
			this.opts.observer.laser(laser);
			return;
		}
		const parsed = parseEvent(payload, this.opts.scrubber);
		if (parsed) {
			if (
				event.sessionId &&
				["click", "highlight", "route", "alert", "quiet"].includes(parsed.type)
			) {
				this.snapshots.capture(event.sessionId, parsed.type, parsed.at);
			}
			this.record(
				parsed,
				[...this.sessions].find(([, id]) => id === event.sessionId)?.[0],
			);
		}
	};

	private record(event: PointerEvent, targetId?: string): void {
		if (
			event.type !== "click" &&
			event.type !== "highlight" &&
			event.type !== "mark" &&
			event.type !== "snapshot"
		) {
			this.write(event);
			return;
		}
		const name = `${FRAMES_DIR}/${String(++this.stills).padStart(4, "0")}-${event.type}.jpg`;
		const job = new Promise<void>((resolve) => {
			setTimeout(resolve, STILL_DELAY_MS);
		}).then(async () => {
			const frame = pickFrame(
				targetId
					? this.frames.filter((frame) => frame.targetId === targetId)
					: this.frames,
				event.at,
			);
			if (frame) {
				try {
					await this.opts.fs.writeBytes(`${this.opts.dir}/${name}`, frame.jpeg);
					event.still = name;
					this.counts.stills++;
				} catch {
					// The event is still worth keeping without its still.
				}
			}
			if (event.type === "click" && targetId) {
				const session = this.sessions.get(targetId);
				if (session) {
					this.snapshots.capture(session, "click-settled", event.at);
				}
			}
			this.write(event);
		});
		this.pending.add(job);
		void job.finally(() => this.pending.delete(job));
	}

	private write(event: PointerEvent): void {
		this.counts.events++;
		this.opts.observer.event(event);
		const line = `${JSON.stringify(event)}\n`;
		this.writing = this.writing
			.then(() => this.opts.fs.append(`${this.opts.dir}/${EVENTS_FILE}`, line))
			.catch(() => undefined);
	}
}
