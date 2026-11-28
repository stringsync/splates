import { beforeEach, describe, expect, it } from "bun:test";
import { FakeFs } from "core/system/testing";
import { conversation, message } from "../fixtures";
import { FsStorage } from "../storage";
import {
	assumedLines,
	formatAssumedLine,
	overturnMessage,
	overturnsIn,
	parseAssumedLine,
} from "./assumed";
import { askingKinds, bandOf } from "./band";
import { extractAssumptions } from "./extract";
import { TrustStore } from "./store";
import type { TrustDecision } from "./types";

const AT = "2026-11-25T20:00:00.000Z";
const KEY = { project: "/repo", agent: "claude", model: "Opus 4.6" };

describe("Assumed lines", () => {
	it("parses the line agents write, with or without the shield", () => {
		expect(
			parseAssumedLine("🛡 Assumed: Retry limit: 3 (vs 5 · defaults)"),
		).toEqual({
			assumed: "Retry limit: 3",
			alternative: "5",
			kind: "defaults",
		});
		expect(
			parseAssumedLine("Assumed: Card style: rail (vs panel · Visual / UI)"),
		).toEqual({
			assumed: "Card style: rail",
			alternative: "panel",
			kind: "visual",
		});
		expect(
			parseAssumedLine("- 🛡 **Assumed:** Split: one task (vs two · scope)"),
		).toEqual({
			assumed: "Split: one task",
			alternative: "two",
			kind: "scope",
		});
	});

	it("ignores lines without an alternative and kind, or in code", () => {
		expect(parseAssumedLine("Assumed: Retry limit: 3")).toBeNull();
		expect(parseAssumedLine("Assumed: x (vs y · nonsense)")).toBeNull();
		expect(
			assumedLines(
				"```\n🛡 Assumed: a (vs b · defaults)\n```\n🛡 Assumed: c (vs d · design)",
			),
		).toEqual([{ assumed: "c", alternative: "d", kind: "design" }]);
	});

	it("writes back what it parses", () => {
		const line = {
			assumed: "Retry limit: 3",
			alternative: "5",
			kind: "defaults",
		} as const;
		expect(parseAssumedLine(formatAssumedLine(line))).toEqual(line);
	});

	it("reads overturn directives from a reply", () => {
		expect(overturnsIn(overturnMessage(2, "Retry limit: 3", "5"))).toEqual([
			{ number: 2, words: "Retry limit: 3 → 5" },
		]);
	});
});

describe("bands", () => {
	const counts = (total: number) => ({
		kept: total,
		amended: 0,
		overturned: 0,
		total,
	});

	it("assumes at 90 over 10 decisions, waits below 70, asks and goes between", () => {
		expect(bandOf({ score: 92, mode: "dynamic", counts: counts(10) })).toBe(
			"assume",
		);
		expect(bandOf({ score: 92, mode: "dynamic", counts: counts(9) })).toBe(
			"ask-and-go",
		);
		expect(bandOf({ score: 92, mode: "static", counts: counts(0) })).toBe(
			"assume",
		);
		expect(bandOf({ score: 89, mode: "dynamic", counts: counts(40) })).toBe(
			"ask-and-go",
		);
		expect(bandOf({ score: 70, mode: "dynamic", counts: counts(40) })).toBe(
			"ask-and-go",
		);
		expect(bandOf({ score: 69, mode: "static", counts: counts(40) })).toBe(
			"ask-and-wait",
		);
	});

	it("sends an overturned kind back to asking until 3 asked picks of it are kept", () => {
		const overturned = decision("2026-11-25T01:00:00.000Z", {
			source: "unasked",
			outcome: "overturned",
		});
		const kept = (hour: number) =>
			decision(`2026-11-25T0${hour + 1}:00:00.000Z`);
		expect(askingKinds([overturned], KEY)).toEqual(["defaults"]);
		expect(askingKinds([overturned, kept(1), kept(2)], KEY)).toEqual([
			"defaults",
		]);
		expect(askingKinds([overturned, kept(1), kept(2), kept(3)], KEY)).toEqual(
			[],
		);
		expect(askingKinds([overturned], KEY, "2026-11-25T02:00:00.000Z")).toEqual(
			[],
		);
		expect(askingKinds([overturned], { ...KEY, model: "Sonnet" })).toEqual([]);
	});
});

describe("assumptions and overturns", () => {
	let store: TrustStore;

	beforeEach(() => {
		store = new TrustStore(new FsStorage("/home/.splates", new FakeFs()));
	});

	it("pauses every project's posture while preserving pinned bands and model edits", async () => {
		const other = { ...KEY, project: "/other" };
		await store.setStatic(KEY, "assume");
		await store.setStatic(other, "ask-and-go");
		const before = await store.list();
		expect((await store.posture(KEY)).band).toBe("assume");
		await store.setEnabled(false);
		expect((await store.posture(KEY)).band).toBe("ask-and-wait");
		expect((await store.posture(other)).band).toBe("ask-and-wait");
		expect(await store.list()).toEqual(before);
		await store.setStatic(other, "ask-and-go");
		expect(await store.enabled()).toBe(false);
		await store.setEnabled(true);
		expect((await store.posture(KEY)).band).toBe("assume");
		expect((await store.posture(other)).band).toBe("ask-and-go");
		expect((await store.entryFor(other)).pinnedBand).toBe("ask-and-go");
	});

	const thread = () =>
		state([
			message(
				"agent",
				"Retrying scans.\n\n🛡 Assumed: Retry limit: 3 (vs 5 · defaults)\n🛡 Assumed: Backoff: linear (vs exponential · design)",
			),
			message("user", "[SPLATES OVERTURN 2] Backoff: linear → exponential"),
		]);

	it("numbers a conversation's assumptions and reads which were overturned", () => {
		const { assumptions, overturns } = extractAssumptions(
			thread(),
			"/repo",
			AT,
		);
		expect(assumptions.map((each) => [each.number, each.assumed])).toEqual([
			[1, "Retry limit: 3"],
			[2, "Backoff: linear"],
		]);
		expect(overturns).toHaveLength(1);
		expect(overturns[0]).toMatchObject({
			id: "overturn:assumed:c1:2",
			source: "unasked",
			outcome: "overturned",
			kind: "design",
			picked: "Backoff: linear",
			instead: "exponential",
			task: "retry-scans",
		});
	});

	it("takes the pick an overturn names over a number that points elsewhere", () => {
		const { overturns } = extractAssumptions(
			state([
				message(
					"agent",
					"🛡 Assumed: Retry limit: 3 (vs 5 · defaults)\n🛡 Assumed: Backoff: linear (vs exponential · design)",
				),
				message("user", "[SPLATES OVERTURN 1] Backoff: linear → exponential"),
			]),
			"/repo",
			AT,
		);
		expect(overturns.map((each) => each.id)).toEqual(["overturn:assumed:c1:2"]);
	});

	it("logs each assumption once and shows its overturn in the log", async () => {
		await store.observeConversation(thread(), "/repo", AT);
		await store.observeConversation(thread(), "/repo", AT);
		const { assumptions, total } = await store.assumptions();
		expect(total).toBe(2);
		const backoff = assumptions.find((each) => each.number === 2);
		expect(backoff?.overturned?.instead).toBe("exponential");
		expect(
			assumptions.find((each) => each.number === 1)?.overturned,
		).toBeNull();
		expect((await store.decisions()).length).toBe(1);
	});

	it("marks a finished conversation's assumption wrong once, sending its kind back to asking", async () => {
		await store.observeConversation(thread(), "/repo", AT);
		expect(await store.markWrong("assumed:c1:1")).toBe(true);
		expect(await store.markWrong("assumed:c1:1")).toBe(false);
		const posture = await store.posture(KEY);
		expect(posture.asking.sort()).toEqual(["defaults", "design"]);
		expect(posture.band).toBe("ask-and-wait");
	});

	it("an unasked pick that stands never raises trust", async () => {
		const before = (await store.entryFor(KEY)).score;
		await store.observeConversation(
			state([message("agent", "🛡 Assumed: Retry limit: 3 (vs 5 · defaults)")]),
			"/repo",
			AT,
		);
		expect((await store.entryFor(KEY)).score).toBe(before);
	});
});

function state(messages: ReturnType<typeof message>[]) {
	return conversation({
		id: "c1",
		agent: "claude",
		task: "retry-scans",
		settings: [
			{
				id: "model",
				name: "Model",
				type: "select",
				category: "model",
				current: "opus",
				options: [{ value: "opus", name: "Opus 4.6", description: null }],
			},
		],
		messages,
	});
}

function decision(
	at: string,
	overrides: Partial<TrustDecision> = {},
): TrustDecision {
	return {
		id: `d:${at}`,
		at,
		...KEY,
		kind: "defaults",
		source: "question",
		outcome: "kept",
		subject: "s",
		conversation: null,
		task: null,
		...overrides,
	};
}
