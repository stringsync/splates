import { describe, expect, test } from "bun:test";
import { Credentials } from "core/creds";
import { FakeFs, FakePs } from "core/system/testing";
import {
	planChunks,
	renderTimeline,
	shiftWords,
	type Transcript,
	utterances,
} from "./timeline";
import { requireKey, transcribe } from "./transcribe";

describe("transcript", () => {
	test("a recording that fits goes up whole, a larger one in even chunks under the limit", () => {
		expect(planChunks(600, 1000, 25_000)).toEqual([{ start: 0, length: 600 }]);
		const chunks = planChunks(1000, 100_000, 25_000);
		expect(chunks).toHaveLength(5);
		expect(chunks[1]?.start).toBeCloseTo(200);
		expect(chunks.reduce((sum, chunk) => sum + chunk.length, 0)).toBeCloseTo(
			1000,
		);
		expect(100_000 / chunks.length).toBeLessThan(25_000);
	});

	test("a chunk's words move to where the chunk sits in the recording", () => {
		expect(shiftWords([{ word: "hi", start: 1, end: 1.5 }], 600)).toEqual([
			{ word: "hi", start: 601, end: 601.5 },
		]);
	});

	test("narration splits at pauses", () => {
		const words = [
			{ word: "the", start: 0, end: 0.2 },
			{ word: "save", start: 0.3, end: 0.6 },
			{ word: "button", start: 0.7, end: 1 },
			{ word: "again", start: 3, end: 3.4 },
		];
		const out = utterances(words);
		expect(out.map((utterance) => utterance.text)).toEqual([
			"the save button",
			"again",
		]);
		expect(out[1]?.start).toBe(3);
	});

	test("the timeline lists utterances in video time", () => {
		const text = renderTimeline({
			version: 1,
			model: "whisper-1",
			prompt: "",
			startedAt: 0,
			text: "",
			words: [],
			utterances: [{ start: 65.25, end: 66, text: "it broke", words: [] }],
		});
		expect(text).toContain("- 01:05.3 narration: it broke");
	});

	test("a session without a mic says so in its timeline instead of saying no speech was heard", () => {
		const empty: Transcript = {
			version: 1,
			model: "whisper-1",
			prompt: "",
			startedAt: 0,
			text: "",
			words: [],
			utterances: [],
		};
		const text = renderTimeline(empty, [], { micOff: true });
		expect(text).toContain("The mic was off");
		expect(text).not.toContain("No speech was heard");
	});

	test("a missing key fails naming the cred", async () => {
		expect(requireKey(new Credentials([]))).rejects.toThrow("OPENAI_API_KEY");
	});
});

test("without a key audio stays untouched and a timeline still lists remarks", async () => {
	const fs = new FakeFs();
	await fs.mkdir("/session", { recursive: true });
	await fs.write("/session/recording.webm", "saved audio");
	await transcribe({
		fs,
		ps: new FakePs(),
		dir: "/session",
		recording: "/session/recording.webm",
		startedAt: 0,
		key: "",
		names: [],
		fetch: async () => {
			throw new Error("must not call OpenAI");
		},
	});
	expect(await fs.read("/session/recording.webm")).toBe("saved audio");
	expect(await fs.exists("/session/transcript.json")).toBe(false);
	const timeline = await fs.read("/session/timeline.md");
	expect(timeline).toContain("OPENAI_API_KEY is not set");
	expect(timeline).toContain("rec transcribe <dir>");
	expect(timeline).not.toContain("No speech was heard");
});

test("reuses a saved transcript when finishing a session again, so whisper is not paid for twice", async () => {
	const fs = new FakeFs();
	await fs.mkdir("/session", { recursive: true });
	await fs.write("/session/recording.webm", "saved audio");
	const heard: Transcript = {
		version: 1,
		model: "whisper-1",
		prompt: "",
		startedAt: 0,
		text: "it broke",
		words: [],
		utterances: [{ start: 2, end: 3, text: "it broke", words: [] }],
	};
	await fs.write("/session/transcript.json", JSON.stringify(heard));
	await transcribe({
		fs,
		ps: new FakePs(),
		dir: "/session",
		recording: "/session/recording.webm",
		startedAt: 0,
		key: "sk-test",
		names: [],
		reuse: true,
		fetch: async () => {
			throw new Error("must not call OpenAI");
		},
	});
	expect(await fs.read("/session/timeline.md")).toContain("it broke");
});
