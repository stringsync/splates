import { BrowserRecording } from "./browser-recording";
import type {
	AudioSink,
	MicPermission,
	Microphone,
	Recording,
} from "./microphone";
import { Pcm16Encoder } from "./pcm16-encoder";

/** Hands each block of the mic's samples to the page, as it comes. */
const TAP = `registerProcessor("tap", class extends AudioWorkletProcessor {
	process([input]) {
		if (input[0] !== undefined) this.port.postMessage(input[0].slice());
		return true;
	}
});`;

/** The mic through `getUserMedia`, tapped by an `AudioWorklet` for its samples. */
export class BrowserMicrophone implements Microphone {
	async permission(): Promise<MicPermission> {
		try {
			const status = await navigator.permissions.query({
				name: "microphone" as PermissionName,
			});
			return status.state;
		} catch {
			// Firefox and older Safari will not say.
			return "unknown";
		}
	}

	start(sink: AudioSink): Promise<Recording> {
		// Made and resumed before any await, while the tap still counts as a
		// gesture: iOS Safari leaves a context made later suspended, silent.
		const context = new AudioContext();
		const resumed = context.resume();
		return this.open(context, resumed, sink).catch((error: unknown) => {
			void context.close();
			throw error;
		});
	}

	private async open(
		context: AudioContext,
		resumed: Promise<void>,
		sink: AudioSink,
	): Promise<Recording> {
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: {
				channelCount: 1,
				echoCancellation: true,
				noiseSuppression: true,
			},
		});
		try {
			// A worklet loads from a URL; one made here needs no route or build.
			const url = URL.createObjectURL(
				new Blob([TAP], { type: "text/javascript" }),
			);
			await context.audioWorklet.addModule(url);
			URL.revokeObjectURL(url);
			// No outputs makes it a sink, which the browser runs without a
			// speaker to play into.
			const tap = new AudioWorkletNode(context, "tap", { numberOfOutputs: 0 });
			const source = context.createMediaStreamSource(stream);
			source.connect(tap);
			await resumed;
			return new BrowserRecording(
				stream,
				context,
				tap,
				new Pcm16Encoder(context.sampleRate, sink),
			);
		} catch (error) {
			for (const track of stream.getTracks()) {
				track.stop();
			}
			throw error;
		}
	}
}
