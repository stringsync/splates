import type { Resource } from "core/disposable";
import type { Eventful } from "core/events";
import { Duration } from "core/time";
import type { Cue } from "./cue";

/** How often a recording says how loud it is. */
export const TICK = Duration.ms(100);

/** Whether the browser hands over the mic, asks first, or refuses; "unknown" when it will not say. */
export type MicPermission = PermissionState | "unknown";

/** Somewhere to record from: the browser's mic, or a fake in a test. */
export interface Microphone {
	/** Whether starting will ask the user for the mic. */
	permission(): Promise<MicPermission>;
	/**
	 * Starts recording, asking for the mic the first time, and sends `sink`
	 * each stretch of audio as it comes. Called on the tap itself, before any
	 * await, so a phone counts it as the user's gesture.
	 */
	start(sink: AudioSink): Promise<Recording>;
}

/** Where a recording's audio goes as it comes: the server's live socket, or a test. */
export interface AudioSink {
	/** Takes the next stretch of audio, PCM16 at `SAMPLE_RATE`. */
	send(pcm: Uint8Array<ArrayBuffer>): void;
}

export interface RecordingEvents extends Record<string, unknown> {
	/**
	 * Every {@link TICK}: how loud the input was since the last, from 0 to 1,
	 * or null when no audio arrived at all.
	 */
	tick: number | null;
	/** Why the recording stopped hearing: the page was hidden, a call took the mic. */
	interrupted: string;
}

/** A recording under way: `dispose` hands over what is left and lets go of the mic. */
export interface Recording extends Eventful<RecordingEvents>, Resource {
	/**
	 * Plays `cue` out loud, quietly. The `start` cue keeps its own sound out of
	 * the recording; a `stop` cue waits for `dispose`, which plays it once the
	 * mic is let go.
	 */
	cue(cue: Cue): void;
}
