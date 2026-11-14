import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Testing } from "../testing";
import { EvalAgentsStore } from "./agents";

describe("EvalAgentsStore", () => {
	let deps: Testing;
	let store: EvalAgentsStore;

	beforeEach(async () => {
		deps = await Testing.open();
		store = new EvalAgentsStore(
			`${deps.splatesHome}/eval-agents.json`,
			deps.fs,
		);
	});

	afterEach(() => deps.disposeAsync());

	it("holds no agents until some are saved", async () => {
		expect(await store.agents()).toEqual([]);
	});

	it("keeps each pick's agent, model and thinking level", async () => {
		const agents = [
			{ agent: "claude", model: "opus", effort: "high" },
			{ agent: "claude", model: "opus", effort: "low" },
			{ agent: "codex" },
			{ agent: "kimi", model: "kimi-code/k3.1-pro" },
		];

		await store.save(agents);

		expect(await store.agents()).toEqual(agents);
	});

	it("drops a saved OpenCode pick", async () => {
		await deps.fs.write(
			`${deps.splatesHome}/eval-agents.json`,
			JSON.stringify({
				format: 1,
				agents: [{ agent: "opencode" }, { agent: "codex" }],
			}),
		);

		expect(await store.agents()).toEqual([{ agent: "codex" }]);
	});

	it("refuses an agent the runner cannot start natively, leaving the file", async () => {
		await store.save([{ agent: "codex" }]);

		expect(store.save([{ agent: "gemini" }])).rejects.toThrow(
			"not eval agents",
		);
		expect(await store.agents()).toEqual([{ agent: "codex" }]);
	});

	it("refuses the same pick twice", async () => {
		expect(
			store.save([
				{ agent: "claude", model: "opus" },
				{ agent: "claude", model: "opus" },
			]),
		).rejects.toThrow("once");
	});
});
