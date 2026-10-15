import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { DictationAdapter } from "@assistant-ui/react";
import { FakeDictationLink, FakeMicrophone } from "webappwiz/dictate/testing";
import { Duration } from "webappwiz/time";
import { Dictation, SILENCE } from "./dictation";

describe("Dictation", () => {
	let microphone: FakeMicrophone;
	let link: FakeDictationLink;
	let dictation: Dictation;

	beforeEach(() => {
		microphone = new FakeMicrophone();
		link = new FakeDictationLink();
		dictation = new Dictation(microphone, async () => link);
	});

	afterEach(() => dictation.dispose());

	/** Waits for `check` to pass, up to a second. */
	const until = async (check: () => boolean) => {
		for (let i = 0; i < 100 && !check(); i++) {
			await Bun.sleep(10);
		}
		expect(check()).toBe(true);
	};

	/** A take started as the composer starts one, with all it said. */
	const listen = () => {
		const session = dictation.listen();
		const said: DictationAdapter.Result[] = [];
		session.onSpeech((result) => said.push(result));
		return { session, said };
	};

	/** Starts a take and waits until it hears audio. */
	const record = async () => {
		const take = listen();
		await until(() => dictation.state.phase === "recording");
		return take;
	};

	it("opens, then records once audio arrives, running the composer's session", async () => {
		const { session } = listen();
		expect(dictation.state.phase).toBe("opening");
		expect(session.status).toEqual({ type: "starting" });

		await until(() => dictation.state.phase === "recording");
		expect(session.status).toEqual({ type: "running" });
		expect(microphone.open).toBe(true);
	});

	it("cues the start when audio arrives and the stop when the take ends", async () => {
		const { session } = listen();
		expect(microphone.cues).toEqual([]);
		await until(() => dictation.state.phase === "recording");
		expect(microphone.cues).toEqual(["start"]);

		await session.stop();
		expect(microphone.cues).toEqual(["start", "stop"]);
	});

	it("cues the stop when the recording is interrupted", async () => {
		await record();
		microphone.interrupt("the page went to the background");
		await until(() => dictation.state.phase !== "recording");
		expect(microphone.cues).toEqual(["start", "stop"]);
	});

	it("plays no cue for a take stopped before any audio came", async () => {
		microphone.said = "";
		const { session } = listen();
		await session.stop();
		expect(microphone.cues).toEqual([]);
	});

	it("gives the composer the text as it is heard, then the final text", async () => {
		const { session, said } = await record();
		microphone.speak(" more");
		await session.stop();

		expect(said).toEqual([
			{ transcript: "something", isFinal: false },
			{ transcript: "something more", isFinal: false },
			{ transcript: "something more", isFinal: true },
		]);
		expect(session.status).toEqual({ type: "ended", reason: "stopped" });
		expect(dictation.state.phase).toBe("idle");
		expect(microphone.open).toBe(false);
	});

	it("stays opening while the mic sends no audio", async () => {
		microphone.speak = () => {};
		listen();
		await Bun.sleep(20);
		microphone.tick(null);
		expect(dictation.state.phase).toBe("opening");
	});

	it("asks for the mic when the browser will prompt", async () => {
		microphone.allowed = "prompt";
		let release: () => void = () => {};
		const start = microphone.start.bind(microphone);
		microphone.start = async (sink) => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return start(sink);
		};
		listen();
		await until(() => dictation.state.phase === "asking");
		release();
		await until(() => dictation.state.phase === "recording");
	});

	it("follows the input's level, and times the take by its ticks", async () => {
		await record();
		microphone.tick(0.8);
		expect(dictation.state.level).toBe(0.8);
		microphone.hold(0.5, Duration.secs(1));
		expect(dictation.state.elapsed.ms).toBeGreaterThanOrEqual(1000);
	});

	it("warns when the open mic hears nothing, until it does", async () => {
		await record();
		microphone.hold(0, SILENCE);
		expect(dictation.state.silent).toBe(true);
		microphone.tick(0.5);
		expect(dictation.state.silent).toBe(false);
	});

	it("stops, keeping the text, and says why when the recording is interrupted", async () => {
		const { session, said } = await record();
		microphone.interrupt("the page went to the background");
		await until(() => session.status.type === "ended");

		expect(said.at(-1)).toEqual({ transcript: "something", isFinal: true });
		expect(dictation.state).toMatchObject({
			phase: "idle",
			error: "Stopped: the page went to the background.",
		});
		expect(microphone.open).toBe(false);
	});

	it("says the mic is blocked when the browser refuses it", async () => {
		microphone.failure = new DOMException(
			"Permission denied",
			"NotAllowedError",
		);
		const { session } = listen();
		await until(() => dictation.state.phase === "denied");
		expect(dictation.state.error).toBe("The mic is blocked for this page.");
		expect(session.status).toEqual({ type: "ended", reason: "error" });
	});

	it("says which cred it needs when the server lacks it", async () => {
		const { session } = listen();
		await until(() => dictation.state.phase === "recording");
		link.fail(
			"dictation needs OPENAI_API_KEY: add it on the Creds page",
			"OPENAI_API_KEY",
		);
		await until(() => session.status.type === "ended");
		expect(dictation.state).toMatchObject({
			phase: "failed",
			error: "Dictation needs OPENAI_API_KEY: add it on the Creds page",
			cred: "OPENAI_API_KEY",
		});
	});

	it("keeps the text heard so far when the link drops mid-take", async () => {
		const { session, said } = await record();
		link.drop();
		await until(() => session.status.type === "ended");

		expect(said.at(-1)).toEqual({ transcript: "something", isFinal: true });
		expect(dictation.state).toMatchObject({
			phase: "failed",
			error: "The connection to the server dropped",
		});
		expect(microphone.open).toBe(false);
	});

	it("cancels a take stopped before any audio came", async () => {
		const speak = microphone.speak.bind(microphone);
		microphone.speak = () => {};
		const { session } = listen();
		await session.stop();
		expect(session.status).toEqual({ type: "ended", reason: "cancelled" });
		expect(dictation.state.phase).toBe("idle");
		microphone.speak = speak;
		await until(() => !microphone.open);
	});

	it("puts away what went wrong when dismissed", async () => {
		microphone.failure = new DOMException("busy", "NotReadableError");
		listen();
		await until(() => dictation.state.phase === "failed");
		dictation.dismiss();
		expect(dictation.state).toMatchObject({ phase: "idle", error: undefined });
	});
});
