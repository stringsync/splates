import type { SpeechSocket, SpeechSockets } from "./live-speech";

/** Opens the real connection to OpenAI's realtime transcription. */
export class OpenAiSockets implements SpeechSockets {
	open(url: string, key: string): SpeechSocket {
		const ws = new WebSocket(url, {
			headers: { Authorization: `Bearer ${key}` },
		} as never);
		const socket: SpeechSocket = {
			send: (data) => ws.send(data),
			dispose: () => ws.close(),
			onopen: null,
			onmessage: null,
			onclose: null,
			onerror: null,
		};
		ws.onopen = () => socket.onopen?.();
		ws.onmessage = (event) => socket.onmessage?.(event);
		ws.onclose = () => socket.onclose?.();
		ws.onerror = () => socket.onerror?.();
		return socket;
	}
}
