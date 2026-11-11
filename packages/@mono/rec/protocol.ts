// What the server and the control window say over their socket. Text frames are
// the messages below as JSON; binary frames are screencast frames one way (an
// 8-byte float64 of when the server received it, in wall-clock ms, then the
// JPEG) and recording chunks the other.

import type { SignalKind } from "./signals";

/** A screencast frame as one binary message: its time, then its JPEG. */
export function packFrame(at: number, jpeg: Uint8Array): Uint8Array {
	const packed = new Uint8Array(8 + jpeg.byteLength);
	new DataView(packed.buffer).setFloat64(0, at);
	packed.set(jpeg, 8);
	return packed;
}

export function unpackFrame(packed: ArrayBuffer): {
	at: number;
	jpeg: Uint8Array<ArrayBuffer>;
} {
	return {
		at: new DataView(packed).getFloat64(0),
		jpeg: new Uint8Array(packed, 8),
	};
}

/** What the control window counted while it recorded. */
export interface RecorderStats {
	/** Frames that reached the window. */
	arrived: number;
	/** Frames drawn onto the canvas. */
	painted: number;
	/** Frames dropped because a newer one arrived before they could be drawn. */
	superseded: number;
	/** Redraws of the last frame while the tab painted nothing, so the video keeps going. */
	repeats: number;
	/** From the server receiving a frame to the canvas drawing it, in ms. */
	latency: { p50: number; p95: number; max: number };
	/** Bytes of recording handed to the server. */
	bytes: number;
}

/** Stats to save a recording with when its control window closed before it could count. */
export const UNKNOWN_STATS: RecorderStats = {
	arrived: 0,
	painted: 0,
	superseded: 0,
	repeats: 0,
	latency: { p50: 0, p95: 0, max: 0 },
	bytes: 0,
};

export type ToServer =
	| {
			type: "started";
			/** When the recorder started, in wall-clock ms. */
			at: number;
			mimeType: string;
			width: number;
			height: number;
			/** The mic's label, or undefined when there is no mic and the recording has no audio. */
			mic?: string;
	  }
	| { type: "stopped"; at: number; stats: RecorderStats }
	| { type: "failed"; message: string }
	/** The mic-off icon was clicked: open a tab that prompts for the mic. */
	| { type: "open-mic-settings" }
	/** The person chose this mic (by label) in the panel; rec remembers it for the next launch. */
	| { type: "mic-choice"; label: string }
	/** The person typed a remark in the panel instead of saying it. */
	| { type: "remark"; text: string }
	/** A slice of the mic's audio while recording: 24 kHz mono 16-bit PCM, base64, for the live transcript. */
	| { type: "audio"; pcm: string };

export type ToControl =
	| { type: "name"; name: string }
	/** The mic chosen last time, by label, sent when the panel connects. */
	| { type: "mic-choice"; label: string }
	| { type: "stop" }
	/** How many frames the server dropped because the window fell behind. */
	| { type: "status"; dropped: number }
	/** Option went down (on) or up in the working tab, the laser trail drawing. */
	| { type: "laser"; on: boolean }
	/** A session was saved to this folder. */
	| { type: "saved"; dir: string }
	/** The session could not be saved. */
	| { type: "save-failed"; message: string }
	/** Something worth a look happened in the working tab: a row for the panel's list. */
	| {
			type: "signal";
			/** Wall-clock ms. */
			at: number;
			kind: SignalKind | "speech";
			title: string;
			detail: string;
			/** A JPEG of the page then, base64. */
			thumbnail?: string;
	  }
	/** The words being said right now, so far; empty text clears the line. */
	| { type: "speech-live"; text: string }
	/** The mic prompt tab was opened. */
	| { type: "mic-settings" };
