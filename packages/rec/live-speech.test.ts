import { expect, test } from "bun:test";
import {
	LiveSpeech,
	type SpeechSocket,
	type SpeechUpdate,
} from "./live-speech";

function fake() {
	const sent: string[] = [];
	const socket: SpeechSocket = {
		send: (data) => sent.push(data),
		dispose: () => {},
		onopen: null,
		onmessage: null,
		onclose: null,
		onerror: null,
	};
	return { sent, socket };
}

test("streams audio once open and reports deltas then the final text", () => {
	const { sent, socket } = fake();
	const updates: SpeechUpdate[] = [];
	let time = 100;
	const speech = new LiveSpeech({
		key: "k",
		clock: { now: () => time++ },
		listener: { update: (update) => updates.push(update), failed: () => {} },
		sockets: { open: () => socket },
	});
	speech.audio("early");
	socket.onopen?.();
	speech.audio("late");
	expect(sent.map((message) => JSON.parse(message).type)).toEqual([
		"session.update",
		"input_audio_buffer.append",
		"input_audio_buffer.append",
	]);
	const say = (event: object) =>
		socket.onmessage?.({ data: JSON.stringify(event) });
	say({
		type: "conversation.item.input_audio_transcription.delta",
		item_id: "a",
		delta: "hel",
	});
	say({
		type: "conversation.item.input_audio_transcription.completed",
		item_id: "a",
		transcript: " hello ",
	});
	expect(updates).toEqual([
		{ id: "a", at: 100, text: "hel", final: false },
		{ id: "a", at: 100, text: "hello", final: true },
	]);
});

test("reports a failure once and stops sending", () => {
	const { sent, socket } = fake();
	const failures: string[] = [];
	const speech = new LiveSpeech({
		key: "k",
		clock: { now: () => 0 },
		listener: { update: () => {}, failed: (message) => failures.push(message) },
		sockets: { open: () => socket },
	});
	socket.onopen?.();
	socket.onmessage?.({
		data: JSON.stringify({ type: "error", error: { message: "bad key" } }),
	});
	socket.onerror?.();
	speech.audio("x");
	expect(failures).toEqual(["bad key"]);
	expect(sent).toHaveLength(1);
});

test("a failed connection puts a row in the panel", async () => {
	const { SpeechPanel } = await import("./speech-panel");
	const said: unknown[] = [];
	new SpeechPanel(
		{ say: (message) => said.push(message) },
		{ error: () => {} },
		{ now: () => 5 },
	).failed("the connection to OpenAI failed");
	expect(said).toContainEqual(
		expect.objectContaining({
			type: "signal",
			at: 5,
			title: "Live transcript stopped",
		}),
	);
});

test("reports an empty update as soon as speech starts, before any words", () => {
	const { socket } = fake();
	const updates: SpeechUpdate[] = [];
	new LiveSpeech({
		key: "k",
		clock: { now: () => 5 },
		listener: { update: (update) => updates.push(update), failed: () => {} },
		sockets: { open: () => socket },
	});
	socket.onmessage?.({
		data: JSON.stringify({
			type: "input_audio_buffer.speech_started",
			item_id: "a",
		}),
	});
	expect(updates).toEqual([{ id: "a", at: 5, text: "", final: false }]);
});
