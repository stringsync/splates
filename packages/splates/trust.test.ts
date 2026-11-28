import { describe, expect, it } from "bun:test";
import { FsStorage } from "@splates/server/storage";
import { TrustStore } from "@splates/server/trust";
import { FakeFs } from "core/system/testing";
import {
	formatPosture,
	formatStanding,
	formatTrustList,
	parseAgentTarget,
	parseSetLevel,
	parseTrustBand,
} from "./trust";

describe("splates trust helpers", () => {
	it("parses agent and optional model from target and flag", () => {
		expect(parseAgentTarget("claude/Opus 4.6", "")).toEqual({
			agent: "claude",
			model: "Opus 4.6",
		});
		expect(parseAgentTarget("codex", "GPT-5.4")).toEqual({
			agent: "codex",
			model: "GPT-5.4",
		});
		expect(parseAgentTarget("claude", "")).toEqual({
			agent: "claude",
			model: null,
		});
	});

	it("parses earned trust bands and rejects numeric 0-100 values", () => {
		expect(parseTrustBand("ask-and-wait")).toBe("ask-and-wait");
		expect(parseTrustBand(" ASK-AND-GO ")).toBe("ask-and-go");
		expect(parseTrustBand("assume")).toBe("assume");
		expect(() => parseTrustBand("85")).toThrow();
		expect(() => parseTrustBand("auto")).toThrow();

		expect(parseSetLevel("auto")).toBe("auto");
		expect(parseSetLevel("assume")).toBe("assume");
		expect(() => parseSetLevel("70")).toThrow();
	});

	it("formats standing metrics compactly", () => {
		expect(
			formatStanding({
				sessions: 0,
				activeDays: 0,
				agreement: null,
				cleanStreak: 0,
				brokenInLast5: 0,
				brokenInLast10: 0,
			}),
		).toBe("0 sessions, 0 days");
		expect(
			formatStanding({
				sessions: 1,
				activeDays: 1,
				agreement: 100,
				cleanStreak: 1,
				brokenInLast5: 0,
				brokenInLast10: 0,
			}),
		).toBe("1 session, 1 day, 100% agreed");
	});

	it("formats trust summaries with earned levels, auto/pinned mode, standing, and asking kinds", async () => {
		const store = new TrustStore(new FsStorage("/home/.splates", new FakeFs()));
		const key = { project: "/repos/mono", agent: "claude", model: "Opus 4.6" };
		await store.record({
			id: "d1",
			at: "2026-11-25T20:00:00Z",
			project: "/repos/mono",
			agent: "claude",
			model: "Opus 4.6",
			kind: "visual",
			source: "mockup",
			outcome: "kept",
			subject: "Card layout?",
			conversation: "c1",
			task: "t1",
		});
		await store.setStatic(key, "ask-and-go");
		const pinned = formatTrustList(
			await store.list({ project: "/repos/mono" }),
		);
		expect(pinned).toBe(
			"mono  claude/Opus 4.6  ask and go  pinned (earned ask and wait)  (1 session, 1 day, 100% agreed)",
		);
		expect(pinned).not.toContain("/100");
		expect(pinned).not.toContain("[visual:");

		await store.setDynamic(key);
		await store.recordUnaskedOverturn({
			...key,
			at: "2026-11-26T10:00:00Z",
			subject: "Retry limit: 3",
		});
		const auto = formatTrustList(await store.list({ project: "/repos/mono" }));
		expect(auto).toBe(
			"mono  claude/Opus 4.6  ask and wait  auto  (2 sessions, 2 days, 33% agreed)  ask first on Defaults",
		);
	});

	it("formats the trust line add and claim print, with kinds sent back to asking", async () => {
		const store = new TrustStore(new FsStorage("/home/.splates", new FakeFs()));
		const key = { project: "/repos/mono", agent: "claude", model: "Opus 4.6" };
		await store.setStatic(key, "assume");
		expect(formatPosture(await store.posture(key))).toBe(
			"  trust:    assume for claude/Opus 4.6 (pinned, 0 sessions, 0 days)",
		);
		await store.recordUnaskedOverturn({ ...key, subject: "Retry limit: 3" });
		expect(formatPosture(await store.posture(key))).toBe(
			"  trust:    assume for claude/Opus 4.6 (pinned, 1 session, 1 day, 0% agreed); ask first on Defaults (overturned)",
		);
	});

	it("pins a band, switches back to auto, and resets back to ask-and-wait", async () => {
		const store = new TrustStore(new FsStorage("/home/.splates", new FakeFs()));
		const key = { project: "/repos/mono", agent: "claude", model: "Opus 4.6" };
		await store.setStatic(key, "ask-and-go", "2026-11-25T20:00:00Z");
		const pinned = await store.entryFor(key);
		expect(pinned.mode).toBe("static");
		expect(pinned.band).toBe("ask-and-go");

		await store.setDynamic(key, "2026-11-25T20:00:30Z");
		const auto = await store.entryFor(key);
		expect(auto.mode).toBe("dynamic");
		expect(auto.band).toBe("ask-and-wait");

		await store.setStatic(key, "assume", "2026-11-25T20:00:45Z");
		await store.reset(key, "2026-11-25T20:01:00Z");
		const reset = await store.entryFor(key);
		expect(reset.mode).toBe("dynamic");
		expect(reset.band).toBe("ask-and-wait");
		expect(reset.standing.sessions).toBe(0);
	});
});
