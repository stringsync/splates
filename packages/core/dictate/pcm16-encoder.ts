import type { AudioSink } from "./microphone";
import { SAMPLE_RATE } from "./pcm";

/** A tenth of a second: few enough messages, and soon enough for live text. */
const CHUNK = SAMPLE_RATE / 10;

/**
 * Turns the mic's float samples, at whatever rate the browser runs at, into
 * PCM16 at {@link SAMPLE_RATE}: `push` each block as it comes, and `flush`
 * once the take ends. Sends `sink` each tenth of a second.
 */
export class Pcm16Encoder {
	// Resampled here rather than by asking an `AudioContext` for the rate,
	// which Firefox refuses to connect a mic to.
	private readonly step: number;
	/** Where the next sample falls in the next input, -1 being the last one before it. */
	private position = 0;
	private previous = 0;
	private chunk = new DataView(new ArrayBuffer(CHUNK * 2));
	private filled = 0;

	constructor(
		inputRate: number,
		private readonly sink: AudioSink,
	) {
		this.step = inputRate / SAMPLE_RATE;
	}

	push(samples: Float32Array): void {
		while (this.position < samples.length - 1) {
			const index = Math.floor(this.position);
			const from = index < 0 ? this.previous : (samples[index] ?? 0);
			const to = samples[index + 1] ?? 0;
			this.write(from + (to - from) * (this.position - index));
			this.position += this.step;
		}
		this.position -= samples.length;
		this.previous = samples[samples.length - 1] ?? this.previous;
	}

	/** Sends what is left of the last chunk. */
	flush(): void {
		if (this.filled > 0) {
			this.sink.send(new Uint8Array(this.chunk.buffer, 0, this.filled * 2));
			this.chunk = new DataView(new ArrayBuffer(CHUNK * 2));
			this.filled = 0;
		}
	}

	private write(sample: number): void {
		const clamped = Math.max(-1, Math.min(1, sample));
		this.chunk.setInt16(
			this.filled * 2,
			Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff),
			true,
		);
		this.filled++;
		if (this.filled === CHUNK) {
			this.flush();
		}
	}
}
