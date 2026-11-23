import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Limit, Setting } from "@splates/server/conversations";
import { quotaLimitsFor } from "./quota-card";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	Testing,
	waitFor,
	within,
} from "./testing";

const hours = (count: number) =>
	new Date(Date.now() + count * 3_600_000).toISOString();

const limit = (
	window: string,
	used: number,
	at: string,
	resets: string | null = hours(2),
): Limit => ({ window, used, resets, at });

const modelSetting = (
	current: string,
	options: { value: string; name: string }[] = [],
): Setting => ({
	id: "model",
	category: "model",
	name: "Model",
	type: "select",
	current,
	options: options.map((each) => ({ ...each, description: null })),
});

describe("QuotaCard", () => {
	const at = "2026-11-22T15:00:00.000Z";
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("returns the current agent's newest limits and omits cap: cooldowns", () => {
		const conv = conversation({
			id: "c1",
			agent: "claude",
			usage: {
				context: null,
				input: 0,
				cached: 0,
				output: 0,
				cost: null,
				limits: [limit("five_hour", 0.6, "2026-11-22T15:05:00.000Z")],
			},
		});
		const result = quotaLimitsFor(
			conv,
			[
				{
					id: "claude",
					name: "Claude",
					settings: [],
					limits: [
						limit("five_hour", 0.4, at),
						limit("seven_day", 0.82, at),
						limit("cap:opus", 1, at),
					],
				},
				{
					id: "codex",
					name: "Codex",
					settings: [],
					limits: [limit("five_hour", 0.1, at)],
				},
			],
			[conv],
		);
		expect(result.limits.map((each) => [each.window, each.used])).toEqual([
			["five_hour", 0.6],
			["seven_day", 0.82],
		]);
		expect(result.at).toBe(Date.parse("2026-11-22T15:05:00.000Z"));
	});

	it("filters grouped and legacy Antigravity limits to the conversation's selected model", () => {
		const grouped = {
			id: "antigravity",
			name: "Antigravity",
			settings: [],
			limits: [
				limit("Gemini Models · Weekly", 0.25, at),
				limit("Gemini Models · Five Hour", 0.1, at),
				limit("Claude and GPT models · Five Hour", 0.8, at),
			],
		};
		const onGemini = conversation({
			id: "c1",
			agent: "antigravity",
			settings: [modelSetting("gemini-4-neon")],
		});
		expect(
			quotaLimitsFor(onGemini, [grouped], [onGemini]).limits.map((each) => [
				each.window,
				each.used,
			]),
		).toEqual([
			["Gemini Models · Five Hour", 0.1],
			["Gemini Models · Weekly", 0.25],
		]);

		const legacy = {
			id: "antigravity",
			name: "Antigravity",
			models: [
				{ id: "gemini-4-neon", name: "Gemini 4 Neon" },
				{ id: "gemini-4-carbon", name: "Gemini 4 Carbon" },
			],
			settings: [],
			limits: [
				limit("All Models · Gemini 4 Neon (Low)", 0.2, at),
				limit("All Models · Gemini 4 Neon (High)", 0.35, at),
				limit("All Models · Gemini 4 Carbon (Medium)", 0.9, at),
			],
		};
		expect(
			quotaLimitsFor(onGemini, [legacy], [onGemini]).limits.map((each) => [
				each.window,
				each.used,
			]),
		).toEqual([["Gemini 4 Neon", 0.35]]);

		const missingModel = conversation({
			id: "c2",
			agent: "antigravity",
			settings: [modelSetting("gemini-3.8-flash")],
		});
		expect(quotaLimitsFor(missingModel, [legacy], [missingModel])).toEqual({
			limits: [],
			at: null,
		});

		const unknownModel = conversation({ id: "c3", agent: "antigravity" });
		expect(
			quotaLimitsFor(unknownModel, [legacy], [unknownModel]).limits.map(
				(each) => [each.window, each.used],
			),
		).toEqual([["Antigravity quota", 0.9]]);
	});

	it("shows the current agent's quota right below Actions with warning and alarm tones, updating live and refreshing on open", async () => {
		const recent = new Date(Date.now() - 2 * 60_000).toISOString();
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: "alpha",
					title: "Fix login",
					agent: "claude",
				}),
			],
			"c1",
			{},
			[
				{
					id: "claude",
					name: "Claude",
					settings: [],
					limits: [
						limit("five_hour", 0.48, recent, hours(2)),
						limit("seven_day", 0.82, recent, hours(50)),
						limit("seven_day_opus", 0.94, recent, hours(50)),
					],
				},
			],
		);

		// Does not refresh limits before widgets open.
		expect(testing.posted("/api/conversations/limits")).toEqual([]);

		const widgets = view.getByRole("region", { name: "widgets" });
		const cards = [...widgets.querySelectorAll("[data-widget]")];
		expect(cards[0]?.getAttribute("aria-label")).toBe("actions");
		expect(cards[1]?.getAttribute("aria-label")).toBe("quota limits");

		const quota = within(widgets).getByRole("region", { name: "quota limits" });
		expect(within(quota).getByRole("heading").textContent).toBe(
			"Claude quota2m ago",
		);
		expect(within(quota).getByLabelText("5-hour").textContent).toContain("48%");
		expect(
			within(within(quota).getByLabelText("Weekly")).getByText("82%").className,
		).toContain("text-warning");
		expect(
			within(within(quota).getByLabelText("Weekly Opus")).getByText("94%")
				.className,
		).toContain("text-destructive");

		// Opening widgets refreshes limits once.
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Widgets" })),
		);
		await waitFor(() =>
			expect(testing.posted("/api/conversations/limits")).toHaveLength(1),
		);

		// Live usage updates replace older values.
		await testing.say(
			conversation({
				id: "c1",
				task: "alpha",
				title: "Fix login",
				agent: "claude",
				usage: {
					context: null,
					input: 0,
					cached: 0,
					output: 0,
					cost: null,
					limits: [
						limit("five_hour", 0.95, new Date().toISOString(), hours(2)),
					],
				},
			}),
		);
		expect(
			within(within(quota).getByLabelText("5-hour")).getByText("95%").className,
		).toContain("text-destructive");
	});

	it("updates Antigravity's grouped widget rows when the conversation switches models, and omits reset when unknown", async () => {
		const recent = new Date().toISOString();
		const settings = (current: string) => [
			modelSetting(current, [
				{ value: "gemini-4-neon", name: "Gemini 4 Neon" },
				{ value: "claude-opus-5-5", name: "Claude Opus 5.5" },
			]),
		];
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					title: "Check quota",
					agent: "antigravity",
					settings: settings("gemini-4-neon"),
				}),
			],
			"c1",
			{},
			[
				{
					id: "antigravity",
					name: "Antigravity",
					settings: [],
					limits: [
						limit("Gemini Models · Five Hour", 0.35, recent, null),
						limit("Gemini Models · Weekly", 0.25, recent, hours(50)),
						limit("Claude and GPT models · Five Hour", 0.85, recent, hours(4)),
					],
				},
			],
		);

		const quota = view.getByRole("region", { name: "quota limits" });
		expect(within(quota).getByRole("heading").textContent).toContain(
			"Antigravity quota",
		);
		expect(
			within(quota).getByLabelText("Gemini Models · 5-hour").textContent,
		).toBe("Gemini Models · 5-hour35%");
		expect(
			within(quota).getByLabelText("Gemini Models · Weekly").textContent,
		).toContain("25%");
		expect(
			within(quota).queryByLabelText("Claude and GPT models · 5-hour"),
		).toBeNull();

		await testing.say(
			conversation({
				id: "c1",
				title: "Check quota",
				agent: "antigravity",
				settings: settings("claude-opus-5-5"),
			}),
		);
		const switched = within(quota).getByLabelText(
			"Claude and GPT models · 5-hour",
		);
		expect(switched.textContent).toContain("85%");
		expect(switched.textContent).toContain("resets ");
		expect(within(quota).queryByLabelText("Gemini Models · 5-hour")).toBeNull();
	});

	it("shows each window's burn rate and a pace icon that explains which window runs out before it resets", async () => {
		const now = new Date().toISOString();
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Burn", agent: "claude" })],
			"c1",
			{},
			[
				{
					id: "claude",
					name: "Claude",
					settings: [],
					limits: [
						// 3h into 5 at 75%: 25%/h, out in 1h, before the reset in 2h.
						limit("five_hour", 0.75, now, hours(2)),
						// A day into the week at 12%: 84% by reset.
						limit("seven_day", 0.12, now, hours(6 * 24)),
					],
				},
			],
		);

		const quota = view.getByRole("region", { name: "quota limits" });
		expect(within(quota).getByLabelText("5-hour").textContent).toContain(
			"25%/h · resets ",
		);
		expect(within(quota).getByLabelText("Weekly").textContent).toContain(
			"12%/day · resets ",
		);
		expect(within(quota).queryByRole("status")).toBeNull();
		fireEvent.click(within(quota).getByRole("button", { name: "quota pace" }));
		const details = await view.findByRole("dialog");
		expect(details.textContent).toContain("5-hour is running ahead");
		expect(details.textContent).toContain("At 25%/h, 5-hour runs out ~");
		expect(details.textContent).toContain(" reset.");
	});

	it("leaves out the pace icon while every window lasts to its reset", async () => {
		const now = new Date().toISOString();
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Calm", agent: "claude" })],
			"c1",
			{},
			[
				{
					id: "claude",
					name: "Claude",
					settings: [],
					limits: [limit("five_hour", 0.3, now, hours(2))],
				},
			],
		);

		const quota = view.getByRole("region", { name: "quota limits" });
		expect(within(quota).getByLabelText("5-hour").textContent).toContain(
			"10%/h · resets ",
		);
		expect(
			within(quota).queryByRole("button", { name: "quota pace" }),
		).toBeNull();
	});

	it("hides the widget when the conversation's agent has reported no limits", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Quiet", agent: "codex" })],
			"c1",
			{},
			[{ id: "codex", name: "Codex", settings: [], limits: [] }],
		);

		expect(view.queryByRole("region", { name: "quota limits" })).toBeNull();
	});
});
