import type { SpeechSocket, SpeechSockets } from "./live-speech";

/** Opens the real connection to OpenAI's realtime transcription. */
export class OpenAiSockets implements SpeechSockets {
	open(url: string, key: string): SpeechSocket {
		return new WebSocket(url, {
			headers: { Authorization: `Bearer ${key}`, "OpenAI-Beta": "realtime=v1" },
		} as never) as unknown as SpeechSocket;
	}
}
