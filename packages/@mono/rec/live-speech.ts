import type { Resource } from "core/disposable";
import { OpenAiSockets } from "./openai-sockets";

/** One stretch of speech as OpenAI's realtime transcription hears it. */
export interface SpeechUpdate {
	/** Names the utterance; deltas and the final text share it. */
	id: string;
	/** Wall-clock ms of the utterance's first words. */
	at: number;
	/** The next words heard (empty when speech has only just begun), or all of the utterance once `final`. */
	text: string;
	final: boolean;
}

/** The slice of `WebSocket` that `LiveSpeech` uses, so a test can stand in for OpenAI. */
export interface SpeechSocket extends Resource {
	send(data: string): void;
	onopen: (() => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	onclose: (() => void) | null;
	onerror: (() => void) | null;
}

/** Opens the connection to OpenAI; a test swaps in its own. */
export interface SpeechSockets {
	open(url: string, key: string): SpeechSocket;
}

/** Who hears about the speech and about the connection failing. */
export interface SpeechListener {
	update(update: SpeechUpdate): void;
	failed(message: string): void;
}

/** What `LiveSpeech` needs from outside. */
export interface SpeechDeps {
	key: string;
	listener: SpeechListener;
	clock: { now(): number };
	sockets?: SpeechSockets;
}

const URL = "wss://api.openai.com/v1/realtime?intent=transcription";

/**
 * Streams the mic's audio to OpenAI's realtime transcription and tells the
 * listener as words arrive. It is best effort: if the connection fails the
 * recording and the transcript made after Stop are unaffected, and nothing
 * more is shown live.
 */
export class LiveSpeech implements Resource {
	private readonly socket: SpeechSocket;
	private ready = false;
	private dead = false;
	private readonly queue: string[] = [];
	private readonly starts = new Map<string, number>();

	constructor(private readonly deps: SpeechDeps) {
		this.socket = (deps.sockets ?? new OpenAiSockets()).open(URL, deps.key);
		this.socket.onopen = () => {
			this.socket.send(
				JSON.stringify({
					type: "session.update",
					session: {
						type: "transcription",
						audio: {
							input: {
								format: { type: "audio/pcm", rate: 24000 },
								transcription: { model: "gpt-4o-transcribe" },
								turn_detection: {
									type: "server_vad",
									silence_duration_ms: 600,
								},
							},
						},
					},
				}),
			);
			this.ready = true;
			for (const chunk of this.queue.splice(0)) {
				this.append(chunk);
			}
		};
		this.socket.onmessage = ({ data }) => this.heard(String(data));
		this.socket.onerror = () => this.fail("the connection to OpenAI failed");
		this.socket.onclose = () => {
			this.dead = true;
		};
	}

	/** Sends 24 kHz mono 16-bit PCM, base64. */
	audio(base64: string): void {
		if (this.dead) {
			return;
		}
		if (this.ready) {
			this.append(base64);
		} else if (this.queue.length < 200) {
			this.queue.push(base64);
		}
	}

	dispose(): void {
		this.dead = true;
		this.socket.dispose();
	}

	private append(base64: string): void {
		this.socket.send(
			JSON.stringify({ type: "input_audio_buffer.append", audio: base64 }),
		);
	}

	private fail(message: string): void {
		if (!this.dead) {
			this.dead = true;
			this.deps.listener.failed(message);
		}
	}

	private heard(raw: string): void {
		let event: Record<string, unknown>;
		try {
			event = JSON.parse(raw) as Record<string, unknown>;
		} catch {
			return;
		}
		const id = String(event.item_id ?? "");
		switch (event.type) {
			case "input_audio_buffer.speech_started": {
				// Words are on their way: tell the listener now, before the first delta.
				if (!this.starts.has(id)) {
					this.starts.set(id, this.deps.clock.now());
				}
				this.deps.listener.update({
					id,
					at: this.starts.get(id) as number,
					text: "",
					final: false,
				});
				return;
			}
			case "conversation.item.input_audio_transcription.delta": {
				if (!this.starts.has(id)) {
					this.starts.set(id, this.deps.clock.now());
				}
				this.deps.listener.update({
					id,
					at: this.starts.get(id) as number,
					text: String(event.delta ?? ""),
					final: false,
				});
				return;
			}
			case "conversation.item.input_audio_transcription.completed": {
				const at = this.starts.get(id) ?? this.deps.clock.now();
				this.starts.delete(id);
				this.deps.listener.update({
					id,
					at,
					text: String(event.transcript ?? "").trim(),
					final: true,
				});
				return;
			}
			case "error": {
				const error = event.error as { message?: string } | undefined;
				this.fail(error?.message ?? "OpenAI refused the transcription");
				return;
			}
		}
	}
}
