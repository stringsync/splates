import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Limit } from "@splates/server/conversations";
import { candidateAgentQuotas, quotaHandoffState } from "./quota-handoff-bar";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
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

describe("QuotaHandoffBar", () => {
	const at = "2026-11-25T14:00:00.000Z";
	let testing: Testing;

	beforeEach(() => {
		sessionStorage.clear();
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		sessionStorage.clear();
	});

	it("computes low and out-of-quota states and ignores expired resets", () => {
		const conv = conversation({ id: "c1", agent: "claude" });
		const now = Date.now();
		const healthy = [
			{
				id: "claude",
				name: "Claude",
				settings: [],
				limits: [limit("five_hour", 0.85, at, hours(2))],
			},
		];
		expect(quotaHandoffState(conv, healthy, [conv], now)).toBeNull();

		const low = [
			{
				id: "claude",
				name: "Claude",
				settings: [],
				limits: [limit("five_hour", 0.94, at, hours(2))],
			},
		];
		expect(quotaHandoffState(conv, low, [conv], now)).toMatchObject({
			severity: "low",
			window: "5-hour",
			used: 0.94,
		});

		const out = [
			{
				id: "claude",
				name: "Claude",
				settings: [],
				limits: [limit("five_hour", 1, at, hours(2))],
			},
		];
		expect(quotaHandoffState(conv, out, [conv], now)).toMatchObject({
			severity: "out",
			window: "5-hour",
			used: 1,
		});

		const expired = [
			{
				id: "claude",
				name: "Claude",
				settings: [],
				limits: [limit("five_hour", 1, at, hours(-1))],
			},
		];
		expect(quotaHandoffState(conv, expired, [conv], now)).toBeNull();
	});

	it("marks out-of-quota candidate agents disabled and leaves unreported ones enabled", () => {
		const now = Date.now();
		const agents = [
			{
				id: "claude",
				name: "Claude",
				settings: [],
				limits: [limit("five_hour", 1, at, hours(2))],
			},
			{
				id: "codex",
				name: "Codex",
				settings: [],
				limits: [limit("five_hour", 0.22, at, hours(2))],
			},
			{
				id: "kimi",
				name: "Kimi",
				settings: [],
				limits: [limit("five_hour", 1, at, hours(2))],
			},
			{
				id: "opencode",
				name: "OpenCode",
				settings: [],
				limits: [],
			},
		];
		const candidates = candidateAgentQuotas("claude", agents, [], now);
		expect(
			candidates.map((each) => ({
				id: each.agent.id,
				out: each.out,
				used: each.used,
			})),
		).toEqual([
			{ id: "codex", out: false, used: 0.22 },
			{ id: "kimi", out: true, used: 1 },
			{ id: "opencode", out: false, used: null },
		]);
	});

	it("shows above the composer when low or out of quota, opens a handoff dialog with meters and dismiss, disables out-of-quota agents, and hands off", async () => {
		const reset = hours(2);
		const agents = [
			{
				id: "claude",
				name: "Claude",
				settings: [],
				limits: [limit("five_hour", 0.94, at, reset)],
			},
			{
				id: "codex",
				name: "Codex",
				settings: [],
				limits: [limit("five_hour", 0.22, at, reset)],
			},
			{
				id: "kimi",
				name: "Kimi",
				settings: [],
				limits: [limit("five_hour", 1, at, reset)],
			},
		];
		const c1 = conversation({
			id: "c1",
			agent: "claude",
			task: null,
			title: "Explore quota bar",
		});
		const view = await testing.openConversations([c1], "c1", {}, agents);

		const bar = view.getByRole("complementary", { name: "Quota handoff" });
		expect(bar.textContent).toContain("Claude is low on quota · 94%");
		expect(bar.textContent).toContain("of 5-hour");

		// Open the dialog and check current meters, reset time, and available vs disabled agents.
		await act(async () =>
			fireEvent.click(within(bar).getByRole("button", { name: /Hand off/ })),
		);
		const dialog = await view.findByRole("dialog");
		const currentQuota = within(dialog).getByRole("list", {
			name: "Current quota",
		});
		expect(currentQuota.textContent).toContain("5-hour");
		expect(currentQuota.textContent).toContain("94%");
		expect(currentQuota.textContent).toContain("resets ");

		const candidates = within(dialog).getByRole("list", {
			name: "Candidate agents",
		});
		const codexItem = within(candidates).getByRole("button", {
			name: /Codex/,
		}) as HTMLButtonElement;
		const kimiItem = within(candidates).getByRole("button", {
			name: /Kimi/,
		}) as HTMLButtonElement;
		expect(codexItem.disabled).toBe(false);
		expect(codexItem.textContent).toContain("22% used");
		expect(kimiItem.disabled).toBe(true);
		expect(kimiItem.textContent).toContain("Out of quota");
		expect(
			within(candidates).queryByRole("button", { name: /Claude/ }),
		).toBeNull();

		// Dismiss for cycle hides the bar for the low-quota cycle...
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Dismiss for cycle" }),
			),
		);
		await waitFor(() =>
			expect(
				view.queryByRole("complementary", { name: "Quota handoff" }),
			).toBeNull(),
		);

		// ...and escalating to out of quota brings it back.
		await testing.say(
			conversation({
				...c1,
				usage: {
					context: null,
					input: 0,
					cached: 0,
					output: 0,
					cost: null,
					limits: [limit("five_hour", 1, hours(0.01), reset)],
				},
			}),
		);
		const escalated = await waitFor(() =>
			view.getByRole("complementary", { name: "Quota handoff" }),
		);
		expect(escalated.textContent).toContain("Claude is out of quota");

		// Picking an available agent hands off (stops/archives c1 and starts codex).
		const prompt =
			"This conversation continues one handed off from another agent. What was said and done last is in /tmp/transcript.md: read its end before going on.";
		testing.reply = {
			...conversation({ id: "c2", agent: "codex", task: null }),
			state: { ...c1, status: "stopped", archived: true },
			prompt,
		};
		await act(async () =>
			fireEvent.click(
				within(escalated).getByRole("button", { name: /Hand off/ }),
			),
		);
		const escalatedDialog = await view.findByRole("dialog");
		const codexPick = within(escalatedDialog).getByRole("button", {
			name: /Codex/,
		});
		await act(async () => fireEvent.click(codexPick));

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/hand-off")).toHaveLength(1),
		);
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c2/prompt")).toHaveLength(1),
		);
		expect(testing.posted("/api/conversations")[0]?.body).toMatchObject({
			agent: "codex",
			task: null,
		});
		expect(
			testing.posted("/api/conversations/c2/prompt")[0]?.body,
		).toMatchObject({ text: prompt });
	});

	it("offers Antigravity's two quota groups separately and lets one hand off to the other", () => {
		const now = Date.now();
		const agents = [
			{
				id: "claude",
				name: "Claude",
				settings: [],
				limits: [limit("five_hour", 1, at, hours(2))],
			},
			{
				id: "antigravity",
				name: "Antigravity",
				models: [
					{ id: "gemini-4-neon", name: "Gemini 4 Neon" },
					{ id: "claude-opus-5-5", name: "Claude Opus 5.5" },
				],
				settings: [],
				limits: [
					limit("Gemini Models · Five Hour", 1, at, hours(2)),
					limit("Claude and GPT models · Five Hour", 0.15, at, hours(2)),
				],
			},
		];

		// From Claude, both Antigravity quotas appear with their own availability.
		const fromClaude = candidateAgentQuotas("claude", agents, [], now);
		expect(
			fromClaude.map((each) => ({
				label: each.label,
				model: each.model,
				out: each.out,
				used: each.used,
			})),
		).toEqual([
			{
				label: "Antigravity · Gemini",
				model: "gemini-4-neon",
				out: true,
				used: 1,
			},
			{
				label: "Antigravity · Claude & GPT",
				model: "claude-opus-5-5",
				out: false,
				used: 0.15,
			},
		]);

		// From Antigravity on a Gemini model, Antigravity's Claude & GPT quota is offered.
		const fromAgyGemini = candidateAgentQuotas(
			"antigravity",
			agents,
			[],
			now,
			"gemini-4-neon",
		);
		expect(
			fromAgyGemini.map((each) => ({
				label: each.label,
				model: each.model,
				out: each.out,
				used: each.used,
			})),
		).toEqual([
			{ label: "Claude", model: undefined, out: true, used: 1 },
			{
				label: "Antigravity · Claude & GPT",
				model: "claude-opus-5-5",
				out: false,
				used: 0.15,
			},
		]);
	});

	it("stays hidden when archived or when no other agent exists", async () => {
		const reset = hours(2);
		const solo = [
			{
				id: "claude",
				name: "Claude",
				settings: [],
				limits: [limit("five_hour", 1, at, reset)],
			},
		];
		const view = await testing.openConversations(
			[conversation({ id: "c1", agent: "claude" })],
			"c1",
			{},
			solo,
		);
		expect(
			view.queryByRole("complementary", { name: "Quota handoff" }),
		).toBeNull();
	});

	it("stays hidden when the conversation is already Done or Removed, and returns on continuation or escalation", async () => {
		const reset = hours(2);
		const agents = [
			{
				id: "claude",
				name: "Claude",
				settings: [],
				limits: [limit("five_hour", 0.96, at, reset)],
			},
			{
				id: "codex",
				name: "Codex",
				settings: [],
				limits: [limit("five_hour", 0.2, at, reset)],
			},
		];
		const base = {
			id: "c1",
			agent: "claude",
			task: null,
			status: "idle" as const,
		};

		const view = await testing.openConversations(
			[
				conversation({
					...base,
					messages: [
						message(
							"agent",
							"## ✅ Done: checked both files\n\nEverything looks good.",
						),
					],
				}),
			],
			"c1",
			{},
			agents,
		);
		expect(
			view.queryByRole("complementary", { name: "Quota handoff" }),
		).toBeNull();

		// A merged or removed ending while stopped also stays hidden.
		await testing.say(
			conversation({
				...base,
				status: "stopped",
				messages: [
					message(
						"agent",
						"## ✅ Merged fix-it onto main\n\nThe fix is on main.",
					),
				],
			}),
		);
		expect(
			view.queryByRole("complementary", { name: "Quota handoff" }),
		).toBeNull();

		await testing.say(
			conversation({
				...base,
				status: "stopped",
				messages: [
					message("agent", "## 🧹 Removed fix-it: moot\n\nAlready fixed."),
				],
			}),
		);
		expect(
			view.queryByRole("complementary", { name: "Quota handoff" }),
		).toBeNull();

		// Continuing the conversation brings the bar back.
		await testing.say(
			conversation({
				...base,
				messages: [
					message(
						"agent",
						"## ✅ Done: checked both files\n\nEverything looks good.",
					),
					message("user", "Can you also check the third file?"),
				],
			}),
		);
		await waitFor(() =>
			expect(
				view.getByRole("complementary", { name: "Quota handoff" }),
			).toBeTruthy(),
		);

		// Escalated and blocked conversations still offer handoff.
		await testing.say(
			conversation({
				...base,
				messages: [
					message(
						"agent",
						"## ⚠️ Escalated fix-it: needs a call\n\nNeeds a decision.",
					),
				],
			}),
		);
		expect(
			view.getByRole("complementary", { name: "Quota handoff" }),
		).toBeTruthy();

		await testing.say(
			conversation({
				...base,
				messages: [
					message(
						"agent",
						"## ⏸ Blocked fix-it: waiting on #12\n\nBack on the board.",
					),
				],
			}),
		);
		expect(
			view.getByRole("complementary", { name: "Quota handoff" }),
		).toBeTruthy();
	});
});
