import { Dispatcher, type Eventful } from "core/events";
import { Duration, SystemTimer, SystemWallClock } from "core/time";
import {
	type RecorderStats,
	type ToControl,
	type ToServer,
	unpackFrame,
} from "../protocol";
import { listMics, openMicInput } from "./mic-input";

/** How long the tab may paint nothing before the last frame is drawn again, so the video keeps time. */
const REPEAT = Duration.ms(500);
/** How long to wait for the tab's first frame, which sets the video's size. */
const FIRST_FRAME = Duration.secs(3);
const FALLBACK = { width: 1280, height: 720 };
/** How long to wait for the server to name the mic chosen last time. */
const CHOICE_WAIT = Duration.secs(1);

/** Where the panel is in a session's life. */
export type Phase = "staged" | "starting" | "recording" | "saving";

/** What the control panel shows. */
/** One row of the panel's list: a signal and a small picture of the page then. */
export type SignalItem = Omit<
	Extract<ToControl, { type: "signal" }>,
	"type" | "thumbnail"
> & { id: number; thumbnail?: string };

export interface PanelState {
	phase: Phase;
	name?: string;
	/** When the recorder started, in wall-clock ms; 0 before it has. */
	startedAt: number;
	/** Whether the mic is open: `unknown` until the first try settles. */
	mic: "unknown" | "on" | "off" | "none" | "muted";
	/** The mic's level, 0 to 1. */
	level: number;
	/** The microphones Chrome lists, by label; empty until the mic has been allowed. */
	devices: string[];
	/** The label of the mic in use, when it is open. */
	device?: string;
	/** Whether Option is held in the working tab, drawing the laser trail. */
	laser: boolean;
	/** What rec noticed while recording, newest first. */
	signals: SignalItem[];
	/** The words being said right now, so far; empty when nobody is speaking. */
	speaking: string;
	/** A line for the person: where a session was saved, what failed, what to allow. */
	status?: string;
	/** The folder the last session was saved to, until the next Start. */
	saved?: string;
	/** Why the last session could not be saved, until the next Start. */
	saveFailed?: string;
}

/**
 * Records the working tab and the mic from the control panel. Read `state`
 * and listen for `change` to show it; call `start` and `stop` for each
 * session and `openMicSettings` when the mic is off.
 */
// The screencast is painted onto a canvas the person never sees, which
// `MediaRecorder` records with the mic, handing the chunks to the server.
export class Capture implements Eventful<{ change: PanelState }> {
	private readonly dispatcher = new Dispatcher<{ change: PanelState }>();
	readonly events = this.dispatcher.events;
	state: PanelState = {
		phase: location.hash.includes("staged") ? "staged" : "starting",
		startedAt: 0,
		mic: location.hash.includes("nomic") ? "none" : "unknown",
		level: 0,
		devices: [],
		laser: false,
		signals: [],
		speaking: "",
	};
	private signalIds = 0;

	private readonly wall = new SystemWallClock();
	private readonly timer = new SystemTimer();
	private readonly socket = new WebSocket(`ws://${location.host}/ws`);
	private readonly canvas = document.createElement("canvas");
	private readonly context = this.canvas.getContext("2d", {
		alpha: false,
	}) as CanvasRenderingContext2D;

	private latencies: number[] = [];
	private stats: Omit<RecorderStats, "latency"> = emptyStats();
	private last: ImageBitmap | undefined;
	private lastDrawn = 0;
	private decoding = false;
	private waiting: ArrayBuffer | undefined;
	/** Whether the canvas has its size yet: a new one is 300 by 150, not empty. */
	private ready = false;
	private firstFrame: (size: { width: number; height: number }) => void =
		() => {};
	private readonly sized = new Promise<{ width: number; height: number }>(
		(resolve) => {
			this.firstFrame = resolve;
			this.timer.setTimeout(() => resolve(FALLBACK), FIRST_FRAME);
		},
	);

	/** The mic's stream, or undefined when it could not be opened and the recording goes without audio. */
	private audio: MediaStream | undefined;
	private microphone: { dispose(): void } | undefined;
	private micTried: Promise<void>;
	/** The label of the mic the person chose, remembered by the server across launches. */
	private chosen: string | undefined;
	/** Settles once the server has said which mic was chosen last time, or after a short wait. */
	private readonly choiceKnown = new Promise<void>((resolve) => {
		this.choiceHeard = resolve;
		this.timer.setTimeout(resolve, CHOICE_WAIT);
	});
	private choiceHeard: () => void = () => {};
	private retrying = false;
	/** Whether the person clicked the mic-off indicator, so a focus is them returning from Settings. */
	private asked = false;

	private recorder: MediaRecorder | undefined;
	private sending = Promise.resolve();
	private stopping: Promise<void> | undefined;

	constructor() {
		this.socket.binaryType = "arraybuffer";
		this.socket.addEventListener("message", ({ data }) => this.receive(data));
		this.timer.setInterval(() => {
			if (this.last && performance.now() - this.lastDrawn >= REPEAT.ms) {
				this.draw(this.last);
				this.stats.repeats++;
			}
		}, Duration.ms(100));
		// Tries the mic when the panel opens, so a denial shows before Start.
		this.micTried = location.hash.includes("nomic")
			? Promise.resolve()
			: this.choiceKnown.then(() => this.openMic());
		navigator.mediaDevices.addEventListener("devicechange", () => {
			void this.listDevices();
		});
		// Retries a denied mic when the panel regains focus, after the person
		// allowed it in Chrome's settings. Only before Start: a recorder's stream
		// cannot take a track once it is running.
		window.addEventListener("focus", () => {
			if (
				this.audio ||
				this.recorder ||
				this.retrying ||
				!this.asked ||
				this.state.mic === "muted"
			) {
				return;
			}
			this.retrying = true;
			this.micTried = this.micTried
				.then(() => this.openMic())
				.finally(() => {
					this.retrying = false;
					if (this.audio) {
						this.set({ status: "Mic allowed" });
					}
				});
		});
	}

	/** Starts recording, from the staged panel or as soon as it opens. */
	start(): void {
		this.set({
			phase: "starting",
			status: undefined,
			saved: undefined,
			saveFailed: undefined,
		});
		this.begin().catch((error: unknown) => {
			this.say({ type: "failed", message: String(error) });
			this.recorder = undefined;
			this.set({ phase: "staged", status: `Failed: ${String(error)}` });
		});
	}

	/** Stops recording and hands the last of it to the server, which saves the session. */
	// vet-ignore resources-are-disposable: stop ends one session; the capture stays ready to start the next
	stop(): Promise<void> {
		this.stopping ??= (async () => {
			const active = this.recorder;
			if (active && active.state !== "inactive") {
				const stopped = new Promise((resolve) =>
					active.addEventListener("stop", resolve, { once: true }),
				);
				active.stop();
				await stopped;
			}
			await this.sending;
			// The mic stays open for the next session; only the canvas video ends.
			for (const track of active?.stream.getVideoTracks() ?? []) {
				track.stop();
			}
			this.say({
				type: "stopped",
				at: this.wall.now(),
				stats: { ...this.stats, latency: percentiles(this.latencies) },
			});
			this.recorder = undefined;
			this.set({ phase: "saving", laser: false, status: "Saving…" });
		})();
		return this.stopping;
	}

	/** Sends a remark the person typed; it lands in the session as typed, not spoken. */
	remark(text: string): void {
		if (text.trim() !== "") {
			this.say({ type: "remark", text });
		}
	}

	/** Turns the mic off by choice, or back on; only before Start, as a running recorder cannot change its tracks. */
	setMicEnabled(enabled: boolean): void {
		if (this.recorder || this.state.mic === "none") {
			return;
		}
		if (!enabled) {
			this.closeMic();
			this.micTried = Promise.resolve();
			this.set({ mic: "muted", level: 0, device: undefined });
			return;
		}
		this.set({ mic: "unknown" });
		this.micTried = this.micTried.then(() => this.openMic());
	}

	/** Switches to the mic with this label (or unmutes it), remembering the choice; only before Start. */
	chooseMic(label: string): void {
		if (this.recorder || this.state.mic === "none") {
			return;
		}
		this.chosen = label;
		this.say({ type: "mic-choice", label });
		this.closeMic();
		this.set({ mic: "unknown", level: 0 });
		this.micTried = this.micTried.then(() => this.openMic());
	}

	/** Asks the server to open a tab that prompts for the mic. */
	openMicSettings(): void {
		this.asked = true;
		this.say({ type: "open-mic-settings" });
	}

	private async addSignal(
		message: Extract<ToControl, { type: "signal" }>,
	): Promise<void> {
		const { type: _type, thumbnail, ...rest } = message;
		const small = thumbnail ? await shrink(thumbnail) : undefined;
		this.set({
			signals: [
				{ ...rest, id: ++this.signalIds, thumbnail: small },
				...this.state.signals,
			].slice(0, MAX_SIGNALS),
		});
	}

	private set(change: Partial<PanelState>): void {
		this.state = { ...this.state, ...change };
		this.dispatcher.dispatch("change", this.state);
	}

	private say(message: ToServer): void {
		this.socket.send(JSON.stringify(message));
	}

	private receive(data: unknown): void {
		if (typeof data === "string") {
			const message = JSON.parse(data) as ToControl;
			if (message.type === "name") {
				this.set({ name: message.name });
			} else if (message.type === "mic-choice") {
				this.chosen = message.label;
				this.choiceHeard();
			} else if (message.type === "saved") {
				this.set({ phase: "staged", status: undefined, saved: message.dir });
			} else if (message.type === "save-failed") {
				this.set({
					phase: "staged",
					status: undefined,
					saveFailed: message.message,
				});
			} else if (message.type === "stop") {
				void this.stop();
			} else if (message.type === "laser") {
				this.set({ laser: message.on });
			} else if (message.type === "speech-live") {
				this.set({ speaking: message.text });
			} else if (message.type === "signal") {
				void this.addSignal(message);
			} else if (message.type === "mic-settings") {
				this.set({
					status: "Allow the microphone in the new tab, then come back here",
				});
			}
			return;
		}
		this.stats.arrived++;
		if (this.decoding) {
			if (this.waiting) {
				this.stats.superseded++;
			}
			this.waiting = data as ArrayBuffer;
			return;
		}
		void this.paint(data as ArrayBuffer);
	}

	/** Decodes and draws a frame, then the newest one that came meanwhile, dropping any between. */
	private async paint(packed: ArrayBuffer): Promise<void> {
		this.decoding = true;
		try {
			const { at, jpeg } = unpackFrame(packed);
			const bitmap = await createImageBitmap(
				new Blob([jpeg], { type: "image/jpeg" }),
			);
			if (!this.ready) {
				this.firstFrame({ width: bitmap.width, height: bitmap.height });
			}
			this.draw(bitmap);
			this.last?.close();
			this.last = bitmap;
			this.stats.painted++;
			this.latencies.push(this.wall.now() - at);
		} finally {
			this.decoding = false;
		}
		const next = this.waiting;
		this.waiting = undefined;
		if (next) {
			await this.paint(next);
		}
	}

	/** Draws a frame to fill the canvas, letterboxed when the tab changed shape. */
	private draw(bitmap: ImageBitmap): void {
		if (!this.ready) {
			return;
		}
		const canvas = this.canvas;
		const context = this.context;
		const scale = Math.min(
			canvas.width / bitmap.width,
			canvas.height / bitmap.height,
		);
		const width = bitmap.width * scale;
		const height = bitmap.height * scale;
		if (width < canvas.width || height < canvas.height) {
			context.fillStyle = "#000";
			context.fillRect(0, 0, canvas.width, canvas.height);
		}
		context.drawImage(
			bitmap,
			(canvas.width - width) / 2,
			(canvas.height - height) / 2,
			width,
			height,
		);
		this.lastDrawn = performance.now();
	}

	/** Closes the open mic, if any. */
	private closeMic(): void {
		this.microphone?.dispose();
		this.microphone = undefined;
		this.audio = undefined;
	}

	/** Lists the mics by label. */
	private async listDevices(): Promise<void> {
		const labels = (await listMics()).map(([label]) => label);
		this.set({ devices: [...new Set(labels)] });
	}

	/** Opens the chosen mic, else Chrome's default, and follows its level; marks it off when it cannot be opened. */
	private async openMic(): Promise<void> {
		if (this.state.mic === "none") {
			return;
		}
		try {
			const id = (await listMics()).find(
				([label]) => label === this.chosen,
			)?.[1];
			const input = await openMicInput(
				id,
				(level) => this.set({ level }),
				(pcm) => {
					if (this.state.phase === "recording") {
						this.say({ type: "audio", pcm });
					}
				},
			);
			this.microphone = input;
			this.audio = input.stream;
			this.set({ mic: "on", device: input.stream.getAudioTracks()[0]?.label });
			await this.listDevices();
		} catch {
			this.closeMic();
			this.set({ mic: "off", level: 0, device: undefined });
		}
	}

	private async begin(): Promise<void> {
		// Nothing carries over from a previous recording.
		this.latencies = [];
		this.stats = emptyStats();
		this.stopping = undefined;
		this.sending = Promise.resolve();
		const [size] = await Promise.all([
			this.sized,
			this.micTried,
			this.socketOpen(),
		]);
		const canvas = this.canvas;
		canvas.width = size.width;
		canvas.height = size.height;
		this.ready = true;
		if (this.last) {
			this.draw(this.last);
		}
		const stream = new MediaStream([
			...canvas.captureStream().getVideoTracks(),
			...(this.audio?.getAudioTracks() ?? []),
		]);
		const mimeType =
			[
				"video/webm;codecs=vp9,opus",
				"video/webm;codecs=vp8,opus",
				"video/webm",
			].find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
		const recorder = new MediaRecorder(stream, {
			mimeType,
			videoBitsPerSecond: 3_000_000,
		});
		this.recorder = recorder;
		recorder.addEventListener("dataavailable", ({ data }) => {
			this.stats.bytes += data.size;
			this.sending = this.sending.then(async () =>
				this.socket.send(await data.arrayBuffer()),
			);
		});
		recorder.addEventListener("start", () => {
			const startedAt = this.wall.now();
			this.say({
				type: "started",
				at: startedAt,
				mimeType: recorder.mimeType || mimeType,
				width: canvas.width,
				height: canvas.height,
				mic: this.audio?.getAudioTracks()[0]?.label,
			});
			this.set({
				phase: "recording",
				startedAt,
				status: undefined,
				signals: [],
				speaking: "",
			});
		});
		recorder.start(1000);
	}

	private socketOpen(): Promise<void> {
		if (this.socket.readyState === WebSocket.OPEN) {
			return Promise.resolve();
		}
		return new Promise((resolve) =>
			this.socket.addEventListener("open", () => resolve(), { once: true }),
		);
	}
}

function emptyStats(): Omit<RecorderStats, "latency"> {
	return { arrived: 0, painted: 0, superseded: 0, repeats: 0, bytes: 0 };
}

function percentiles(values: number[]): RecorderStats["latency"] {
	const sorted = [...values].sort((left, right) => left - right);
	const at = (share: number) =>
		Math.round(
			sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ??
				0,
		);
	return { p50: at(0.5), p95: at(0.95), max: Math.round(sorted.at(-1) ?? 0) };
}

/** Rows kept in the list. */
const MAX_SIGNALS = 100;
/** A thumbnail's width in pixels, twice what it shows at. */
const THUMB_WIDTH = 160;

/** A base64 JPEG as a small data URL, or undefined when it cannot be decoded. */
async function shrink(base64: string): Promise<string | undefined> {
	try {
		const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
		const image = await createImageBitmap(new Blob([bytes]));
		const scale = Math.min(1, THUMB_WIDTH / image.width);
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(image.width * scale);
		canvas.height = Math.round(image.height * scale);
		canvas
			.getContext("2d")
			?.drawImage(image, 0, 0, canvas.width, canvas.height);
		image.close();
		return canvas.toDataURL("image/jpeg", 0.6);
	} catch {
		return undefined;
	}
}
