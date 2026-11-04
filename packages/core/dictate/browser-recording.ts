import { Disposer } from "core/disposable";
import { Dispatcher } from "core/events";
import { Duration, SystemTimer, sleep } from "core/time";
import { type Cue, cueLength, playCue } from "./cue";
import { type Recording, type RecordingEvents, TICK } from "./microphone";
import type { Pcm16Encoder } from "./pcm16-encoder";

/**
 * How long the stop cue waits for the context to play again once the mic is
 * let go, as iOS pauses it while it moves the audio off recording.
 */
const SETTLE = Duration.secs(1);

/** The level, in dBFS, that reads as silence and as full. */
const FLOOR_DB = -60;
const FULL_DB = -10;

/**
 * One take from the mic, its samples encoded as they arrive from the tap. It
 * keeps the screen awake while it records, and stops hearing, saying why, when
 * the page is hidden or the system takes the mic, as a call does.
 */
export class BrowserRecording implements Recording {
	private readonly disposer = new Disposer();
	private readonly dispatcher = this.disposer.use(
		new Dispatcher<RecordingEvents>(),
	);
	readonly events = this.dispatcher.events;
	private squares = 0;
	private samples = 0;
	private wakeLock: Promise<WakeLockSentinel | undefined>;
	/** Until when the mic would hear the start cue, so its samples are dropped. */
	private deaf = 0;
	/** Whether to play the stop cue once the mic is let go. */
	private stopCue = false;

	constructor(
		/**
		 * The mic's stream, for a page that records it too (a `MediaRecorder`)
		 * without opening the mic again. It stays the recording's: its tracks stop
		 * on `dispose`.
		 */
		readonly stream: MediaStream,
		private readonly context: AudioContext,
		private readonly tap: AudioWorkletNode,
		private readonly encoder: Pcm16Encoder,
	) {
		tap.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
			if (performance.now() < this.deaf) {
				return;
			}
			for (const sample of data) {
				this.squares += sample * sample;
			}
			this.samples += data.length;
			encoder.push(data);
		};
		this.disposer.use(new SystemTimer().setInterval(this.tick, TICK));
		this.wakeLock =
			navigator.wakeLock?.request("screen").catch(() => undefined) ??
			Promise.resolve(undefined);
		this.listen(document, "visibilitychange", () => {
			if (document.visibilityState === "hidden") {
				this.interrupt("the page went to the background");
			}
		});
		this.listen(window, "pagehide", () =>
			this.interrupt("the page went to the background"),
		);
		for (const track of stream.getAudioTracks()) {
			this.listen(track, "ended", () =>
				this.interrupt("the mic was taken away or unplugged"),
			);
			// iOS mutes the track for a call, Siri or another app's recording.
			this.listen(track, "mute", () =>
				this.interrupt("the system took the mic, as for a call"),
			);
		}
		this.listen(context, "statechange", () => {
			// Safari's own state for a call or an alarm taking the audio.
			if ((context.state as string) === "interrupted") {
				this.interrupt("the system took the mic, as for a call");
			}
		});
	}

	cue(cue: Cue): void {
		if (cue === "start") {
			// The start cue would otherwise come back through the mic.
			this.deaf = performance.now() + cueLength(cue) + 50;
			void playCue(this.context, cue);
		} else {
			this.stopCue = true;
		}
	}

	dispose(): void {
		this.tap.port.onmessage = null;
		this.encoder.flush();
		this.disposer.dispose();
		// Stopping the tracks is what turns off the browser's recording light.
		for (const track of this.stream.getTracks()) {
			track.stop();
		}
		void this.wakeLock.then((lock) => lock?.release());
		void this.close();
	}

	/**
	 * Plays the stop cue only now the mic is cold: a phone drops a sound that
	 * plays while it moves its audio off recording.
	 */
	private async close(): Promise<void> {
		if (this.stopCue) {
			await Promise.race([this.context.resume(), sleep(SETTLE)]);
			await playCue(this.context, "stop");
		}
		await this.context.close();
	}

	private readonly tick = (): void => {
		if (this.samples === 0) {
			this.dispatcher.dispatch("tick", null);
			return;
		}
		const rms = Math.sqrt(this.squares / this.samples);
		this.squares = 0;
		this.samples = 0;
		const db = 20 * Math.log10(rms || Number.MIN_VALUE);
		const level = (db - FLOOR_DB) / (FULL_DB - FLOOR_DB);
		this.dispatcher.dispatch("tick", Math.min(1, Math.max(0, level)));
	};

	private interrupt(why: string): void {
		this.dispatcher.dispatch("interrupted", why);
	}

	private listen(
		target: EventTarget,
		type: string,
		listener: () => void,
	): void {
		target.addEventListener(type, listener);
		this.disposer.defer(() => target.removeEventListener(type, listener));
	}
}
