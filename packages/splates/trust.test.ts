import { describe, expect, it } from "bun:test";
import { FsStorage } from "@splates/server/storage";
import { TrustStore } from "@splates/server/trust";
import { FakeFs } from "core/system/testing";
import { formatPosture, formatTrustList, parseAgentTarget } from "./trust";

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

	it("formats trust summaries with mode, counts, and kind breakdown", async () => {
		const store = new TrustStore(new FsStorage("/home/.splates", new FakeFs()));
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
		await store.setStatic(
			{ project: "/repos/mono", agent: "claude", model: "Opus 4.6" },
			85,
		);
		const text = formatTrustList(await store.list({ project: "/repos/mono" }));
		expect(text).toContain("mono");
		expect(text).toContain("claude/Opus 4.6");
		expect(text).toContain("85/100");
		expect(text).toContain("static (dynamic");
		expect(text).toContain("1 kept, 0 amended, 0 overturned");
		expect(text).toContain("[visual:");
	});

	it("formats the trust line add and claim print, with kinds sent back to asking", async () => {
		const store = new TrustStore(new FsStorage("/home/.splates", new FakeFs()));
		const key = { project: "/repos/mono", agent: "claude", model: "Opus 4.6" };
		await store.setStatic(key, 95);
		expect(formatPosture(await store.posture(key))).toBe(
			"  trust:    95/100 for claude/Opus 4.6 (static): assume",
		);
		await store.recordUnaskedOverturn({ ...key, subject: "Retry limit: 3" });
		expect(formatPosture(await store.posture(key))).toBe(
			"  trust:    95/100 for claude/Opus 4.6 (static): assume; ask first on Defaults (overturned)",
		);
	});

	it("keeps dynamic mode when setting a value and resets to neutral 50", async () => {
		const store = new TrustStore(new FsStorage("/home/.splates", new FakeFs()));
		const key = { project: "/repos/mono", agent: "claude", model: "Opus 4.6" };
		await store.setValue(key, 78, "2026-11-25T20:00:00Z");
		const set = await store.entryFor(key);
		expect(set.mode).toBe("dynamic");
		expect(set.score).toBe(78);
		await store.reset(key, "2026-11-25T20:01:00Z");
		const reset = await store.entryFor(key);
		expect(reset.mode).toBe("dynamic");
		expect(reset.score).toBe(50);
	});
});
