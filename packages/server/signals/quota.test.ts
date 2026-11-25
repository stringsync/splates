import { describe, expect, it } from "bun:test";
import { MemoryLogger } from "core/log";
import { FakeTimer } from "core/time/testing";
import type { Limit } from "../conversations";
import { MemoryStorage } from "../storage/testing";
import { callOf, STANDARD_SIGNAL_FUNCTIONS } from "./call";
import {
	lastUserMessagesOf,
	overarching,
	type QuotaFired,
	QuotaSignals,
	quotaRaises,
	windowLengthMs,
} from "./quota";

const NOW = Date.parse("2026-11-25T12:00:00.000Z");
const hours = (count: number) =>
	new Date(NOW + count * 3_600_000).toISOString();

const limit = (window: string, used: number, resets: string | null): Limit => ({
	window,
	used,
	resets,
	at: hours(-1),
});

const canonical = (text: string) =>
	callOf(text, STANDARD_SIGNAL_FUNCTIONS).canonical;

describe("windowLengthMs", () => {
	it("reads the length each provider names its windows by", () => {
		expect(windowLengthMs("five_hour")).toBe(5 * 3_600_000);
		expect(windowLengthMs("seven_day")).toBe(7 * 86_400_000);
		expect(windowLengthMs("seven_day_opus")).toBe(7 * 86_400_000);
		expect(windowLengthMs("10080_minutes")).toBe(7 * 86_400_000);
		expect(windowLengthMs("month")).toBe(30 * 86_400_000);
		expect(windowLengthMs("Gemini Models · Weekly")).toBe(7 * 86_400_000);
		expect(windowLengthMs("Claude and GPT models · Five Hour")).toBe(
			5 * 3_600_000,
		);
		expect(windowLengthMs("credits")).toBeNull();
	});
});

describe("overarching", () => {
	it("keeps the plain longest window over its sub-limits and the five-hour one", () => {
		const claude = [
			limit("five_hour", 0.4, hours(2)),
			limit("seven_day", 0.2, hours(10)),
			limit("seven_day_opus", 0.1, hours(10)),
			limit("seven_day_overage_included", 0.01, hours(10)),
		];
		expect(overarching(claude).map((each) => each.window)).toEqual([
			"seven_day",
		]);
	});

	it("keeps every weekly window when each covers its own models", () => {
		const antigravity = [
			limit("Gemini Models · Weekly", 0.2, hours(10)),
			limit("Gemini Models · Five Hour", 0.2, hours(2)),
			limit("Claude and GPT models · Weekly", 0.2, hours(10)),
		];
		expect(overarching(antigravity).map((each) => each.window)).toEqual([
			"Gemini Models · Weekly",
			"Claude and GPT models · Weekly",
		]);
	});

	it("takes the monthly window over a five-hour one", () => {
		expect(
			overarching([
				limit("five_hour", 0.2, hours(2)),
				limit("month", 0.2, hours(10)),
			]).map((each) => each.window),
		).toEqual(["month"]);
	});
});

describe("quotaRaises", () => {
	it("raises quota.low at 90% used, bare, by agent, and by agent and window", () => {
		const raises = quotaRaises(
			{ claude: [limit("five_hour", 0.92, hours(2))] },
			{},
			NOW,
			new Set(),
		);
		expect(raises).toHaveLength(1);
		expect(raises[0]?.names).toEqual([
			"quota.low",
			canonical('quota.low("claude")'),
			canonical('quota.low({ agent: "claude", window: "five_hour" })'),
		]);
		expect(raises[0]?.payload).toMatchObject({
			agent: "claude",
			window: "five_hour",
			used: 0.92,
			lastUserMessageAt: null,
		});
	});

	it("raises nothing under 90%, nor again for a cycle already raised", () => {
		const agents = { claude: [limit("five_hour", 0.95, hours(2))] };
		expect(
			quotaRaises(
				{ claude: [limit("five_hour", 0.89, hours(2))] },
				{},
				NOW,
				new Set(),
			),
		).toEqual([]);
		const [first] = quotaRaises(agents, {}, NOW, new Set());
		expect(quotaRaises(agents, {}, NOW, new Set([first?.key ?? ""]))).toEqual(
			[],
		);
	});

	it("raises quota.unused in the last 10% of the weekly window while under half is used", () => {
		// The last 10% of seven days is 16.8 hours.
		const late = quotaRaises(
			{
				claude: [
					limit("five_hour", 0.1, hours(2)),
					limit("seven_day", 0.3, hours(16)),
				],
			},
			{},
			NOW,
			new Set(),
		);
		expect(late.map((each) => each.names)).toEqual([
			[
				"quota.unused",
				canonical('quota.unused("claude")'),
				canonical('quota.unused({ agent: "claude", window: "seven_day" })'),
			],
		]);
		const early = quotaRaises(
			{ claude: [limit("seven_day", 0.3, hours(20))] },
			{},
			NOW,
			new Set(),
		);
		expect(early).toEqual([]);
		const used = quotaRaises(
			{ claude: [limit("seven_day", 0.6, hours(16))] },
			{},
			NOW,
			new Set(),
		);
		expect(used).toEqual([]);
	});

	it("never raises quota.unused for a five-hour window", () => {
		expect(
			quotaRaises(
				{
					kimi: [
						limit("five_hour", 0.1, hours(0.25)),
						limit("month", 0.6, hours(100)),
					],
				},
				{},
				NOW,
				new Set(),
			),
		).toEqual([]);
	});

	it("raises quota.restored once a reset passes, from a cycle's peak too", () => {
		const raises = quotaRaises(
			{ codex: [limit("seven_day", 0.1, hours(160))] },
			{
				codex: [
					{
						window: "seven_day",
						resets: hours(-0.1),
						peak: 0.8,
						lastAt: hours(-3),
					},
				],
			},
			NOW,
			new Set(),
		);
		expect(raises.map((each) => each.names[1])).toEqual([
			canonical('quota.restored("codex")'),
		]);
		expect(raises[0]?.payload.used).toBe(0.8);
	});

	it("raises no quota.restored for a reset long past, nor one nothing used", () => {
		expect(
			quotaRaises(
				{
					codex: [limit("seven_day", 0.1, hours(-1))],
					antigravity: [limit("Gemini Models · Five Hour", 0, hours(-0.1))],
				},
				{},
				NOW,
				new Set(),
			),
		).toEqual([]);
	});

	it("takes a reset that drifted a few minutes as the cycle already raised", () => {
		const [first] = quotaRaises(
			{ claude: [limit("five_hour", 0.95, hours(2))] },
			{},
			NOW,
			new Set(),
		);
		expect(
			quotaRaises(
				{ claude: [limit("five_hour", 0.96, hours(2.1))] },
				{},
				NOW,
				new Set([first?.key ?? ""]),
			),
		).toEqual([]);
	});
});

describe("lastUserMessagesOf", () => {
	it("finds each agent's latest user-authored message and ignores agent and told prompts", () => {
		expect(
			lastUserMessagesOf([
				{
					state: {
						agent: "claude",
						messages: [
							{ role: "user", at: hours(-5) },
							{ role: "agent", at: hours(-4) },
							{ role: "user", at: hours(-1), told: "splates" },
						],
					},
				},
				{
					state: {
						agent: "claude",
						messages: [{ role: "user", at: hours(-3) }],
					},
				},
				{
					state: {
						agent: "codex",
						messages: [{ role: "user", at: hours(-2), told: "other-conv" }],
					},
				},
			]),
		).toEqual({ claude: hours(-3) });
	});
});

describe("QuotaSignals", () => {
	it("raises each due firing once, across a restart, with lastUserMessageAt", async () => {
		const storage = new MemoryStorage();
		const raised: { name: string; payload: unknown }[] = [];
		const deps = {
			limits: async () => ({
				agents: { claude: [limit("five_hour", 0.95, hours(2))] },
				peaks: {},
			}),
			lastUserMessages: async () => ({ claude: hours(-3) }),
			raise: async (name: string, payload: unknown) => {
				raised.push({ name, payload });
			},
			doc: storage.document<QuotaFired>("quota-signals.json"),
			log: new MemoryLogger(),
			now: () => NOW,
			timer: new FakeTimer(),
		};
		const first = QuotaSignals.start(deps);
		await first.look();
		first.dispose();
		const second = QuotaSignals.start(deps);
		await second.look();
		second.dispose();
		expect(raised.map((each) => each.name)).toEqual([
			"quota.low",
			canonical('quota.low("claude")'),
			canonical('quota.low({ agent: "claude", window: "five_hour" })'),
		]);
		expect(raised[0]?.payload).toMatchObject({
			agent: "claude",
			lastUserMessageAt: hours(-3),
		});
	});
});
