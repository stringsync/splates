import { expect, it } from "bun:test";
import { type ConversationState, unused } from "../conversations";
import { catalogKey } from "../prices/prices";
import { Spend } from "../spend";
import { MemoryStorage } from "../storage/testing";
import { fold } from "./fold";

/** A stored OpenCode conversation, as its log folds back. */
const stored = (): ConversationState =>
	({
		id: "c",
		agent: "opencode",
		messages: [],
		events: [],
		commands: [],
		settings: [],
		background: [],
		progress: [],
		artifacts: [],
		usage: unused(),
	}) as unknown as ConversationState;

it("folds a recorded OpenCode conversation's usage and cost", () => {
	const into = stored();
	fold(into, {
		sessionUpdate: "usage_update",
		used: 10,
		size: 100,
		cost: { amount: 0.5, currency: "USD" },
	});
	expect(into.usage.context).toEqual({ used: 10, size: 100 });
	expect(into.usage.cost?.amount).toBe(0.5);
});

it("keeps an OpenCode spend row and totals it by provider", async () => {
	const spend = new Spend(new MemoryStorage());
	await spend.record({
		at: "2026-10-21T10:00:00.000Z",
		provider: "opencode",
		service: "opencode-go/kimi-k3",
		kind: "billed",
		dollars: 2,
		project: null,
		task: null,
		conversation: null,
	});
	const rows = await spend.totals({ by: "provider" });
	expect(rows.map((row) => [row.provider, row.billed])).toEqual([
		["opencode", 2],
	]);
});

it("prices an OpenCode model by its own provider key", () => {
	expect(catalogKey("opencode", "opencode-go/kimi-k3")).toBe(
		"opencode-go/kimi-k3",
	);
	expect(catalogKey("opencode", "bare")).toBeNull();
});
