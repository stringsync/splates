import { beforeEach, describe, expect, it } from "bun:test";
import { FakeFs } from "core/system/testing";
import { Duration } from "core/time";
import { FakeTimer, FakeWallClock } from "core/time/testing";
import { FakeAgent } from "../agents/testing";
import { Limits } from "../models";
import { FsStorage } from "../storage";
import { Conversations } from "./index";

const AGENT = { id: "fake", name: "Fake", argv: ["fake-acp"] };

describe("Conversations.refreshLimits", () => {
	const window = {
		window: "five_hour",
		used: 0.2,
		resets: "2026-10-11T15:00:00.000Z",
		at: "2026-10-11T10:00:00.000Z",
	};
	let clock: FakeWallClock;
	let asked: string[];
	let conversations: Conversations;

	beforeEach(() => {
		clock = new FakeWallClock(Date.parse("2026-10-11T10:00:00Z"));
		asked = [];
		conversations = new Conversations(
			"/repo/.git/splates/conversations",
			[AGENT],
			{
				fs: new FakeFs(),
				timer: new FakeTimer(),
				clock,
				limits: new Limits(
					new FsStorage("/home/.splates", new FakeFs()).document("limits.json"),
				),
				launch: new FakeAgent().launch,
				readLimits: async (each) => {
					asked.push(each.id);
					return [window];
				},
			},
		);
	});

	it("asks an agent that does not send its limits, and keeps what it says", async () => {
		await conversations.refreshLimits();

		expect(asked).toEqual(["fake"]);
		expect(await conversations.limits()).toEqual({ fake: [window] });
	});

	it("asks again only after five minutes", async () => {
		await conversations.refreshLimits();
		await conversations.refreshLimits();
		expect(asked).toEqual(["fake"]);

		clock.advance(Duration.mins(6));
		await conversations.refreshLimits();
		expect(asked).toEqual(["fake", "fake"]);
	});

	it("replaces stale windows on a full refresh and stops old logs from re-adding them", async () => {
		const storage = new FsStorage("/home/.splates", new FakeFs());
		const limits = new Limits(storage.document("limits.json"));
		const stale = {
			window: "All Models · Gemini 4 Neon",
			used: 0.5,
			resets: null,
			at: "2026-10-11T09:00:00.000Z",
		};
		const fresh = [
			{
				window: "Gemini Models · Weekly",
				used: 0.2,
				resets: "2026-10-18T10:00:00.000Z",
				at: "2026-10-11T10:00:00.000Z",
			},
			{
				window: "Gemini Models · Five Hour",
				used: 0.4,
				resets: "2026-10-11T15:00:00.000Z",
				at: "2026-10-11T10:00:00.000Z",
			},
		];
		await limits.remember("fake", [stale]);
		let current = fresh;
		const refreshed = new Conversations(
			"/repo/.git/splates/conversations",
			[AGENT],
			{
				fs: new FakeFs(),
				timer: new FakeTimer(),
				clock,
				limits,
				launch: new FakeAgent().launch,
				readLimits: async () => current,
			},
		);

		await refreshed.refreshLimits();
		expect(await refreshed.limits()).toEqual({ fake: fresh });

		// An empty read (offline CLI) keeps the last known snapshot.
		current = [];
		clock.advance(Duration.mins(6));
		await refreshed.refreshLimits();
		expect(await refreshed.limits()).toEqual({ fake: fresh });

		// Replaying an older log after restart does not resurrect dropped windows.
		const reloaded = new Limits(storage.document("limits.json"));
		await reloaded.remember("fake", [stale]);
		expect(await reloaded.all()).toEqual({ fake: fresh });
	});
});
