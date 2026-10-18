import { beforeEach, describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { Duration } from "webappwiz/time";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { AGENT, FakeAgent } from "../agents/testing";
import { Limits } from "../models";
import { Conversations } from "./index";

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
				limits: new Limits("/home/.splates/limits.json", { fs: new FakeFs() }),
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
});
