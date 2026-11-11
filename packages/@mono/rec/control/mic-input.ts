import { Duration, SystemTimer } from "core/time";

/** An open microphone: its stream to record, and the level it is hearing. */
export interface MicInput {
	stream: MediaStream;
	dispose(): void;
}

const timer = new SystemTimer();

/** Opens the mic with this id (else Chrome's default), calling `onLevel` with its loudness, 0 to 1, as it comes. */
export async function openMicInput(
	deviceId: string | undefined,
	onLevel: (level: number) => void,
	/** Called with each slice of the mic as 24 kHz mono 16-bit PCM, base64, for the live transcript. */
	onPcm?: (pcm: string) => void,
): Promise<MicInput> {
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: {
			...(deviceId && { deviceId: { exact: deviceId } }),
			channelCount: 1,
			echoCancellation: true,
			noiseSuppression: true,
		},
	});
	const context = new AudioContext();
	const analyser = context.createAnalyser();
	analyser.fftSize = 512;
	context.createMediaStreamSource(stream).connect(analyser);
	const samples = new Float32Array(analyser.fftSize);
	const ticking = timer.setInterval(() => {
		analyser.getFloatTimeDomainData(samples);
		let sum = 0;
		for (const sample of samples) {
			sum += sample * sample;
		}
		onLevel(Math.sqrt(sum / samples.length));
	}, Duration.ms(50));
	const pcm = onPcm ? await tapPcm(stream, onPcm) : undefined;
	return {
		stream,
		dispose: () => {
			pcm?.();
			ticking.dispose();
			for (const track of stream.getTracks()) {
				track.stop();
			}
			void context.close();
		},
	};
}

/** The mics Chrome lists, as [label, id]; Chrome gives labels only once the mic is allowed. */
export async function listMics(): Promise<Array<[string, string]>> {
	const all = await navigator.mediaDevices.enumerateDevices();
	return all
		.filter((device) => device.kind === "audioinput" && device.label !== "")
		.map((device): [string, string] => [device.label, device.deviceId]);
}

const WORKLET = `registerProcessor("pcm", class extends AudioWorkletProcessor {
	process(inputs) {
		const channel = inputs[0][0];
		if (channel) this.port.postMessage(channel.slice());
		return true;
	}
});`;

/** Streams the mic as ~100 ms slices of 24 kHz 16-bit PCM (base64); returns how to stop. */
async function tapPcm(
	stream: MediaStream,
	onPcm: (pcm: string) => void,
): Promise<() => void> {
	const context = new AudioContext({ sampleRate: 24000 });
	const url = URL.createObjectURL(
		new Blob([WORKLET], { type: "application/javascript" }),
	);
	await context.audioWorklet.addModule(url);
	URL.revokeObjectURL(url);
	const node = new AudioWorkletNode(context, "pcm");
	let pending: Int16Array[] = [];
	let length = 0;
	node.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
		const ints = new Int16Array(data.length);
		for (let i = 0; i < data.length; i++) {
			ints[i] = Math.max(-1, Math.min(1, data[i] ?? 0)) * 0x7fff;
		}
		pending.push(ints);
		length += ints.length;
		if (length >= 2400) {
			const joined = new Int16Array(length);
			let at = 0;
			for (const part of pending) {
				joined.set(part, at);
				at += part.length;
			}
			pending = [];
			length = 0;
			let binary = "";
			for (const byte of new Uint8Array(joined.buffer)) {
				binary += String.fromCharCode(byte);
			}
			onPcm(btoa(binary));
		}
	};
	// Chrome only runs a worklet that reaches the output, so end it in a muted gain.
	const mute = context.createGain();
	mute.gain.value = 0;
	context.createMediaStreamSource(stream).connect(node);
	node.connect(mute).connect(context.destination);
	await context.resume();
	return () => {
		node.port.close();
		void context.close();
	};
}
