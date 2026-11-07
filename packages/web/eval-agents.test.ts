import { describe, expect, it } from "bun:test";
import type { EvalAgentsView } from "@splates/server/evals/browser";
import type { AgentPick } from "@splates/server/models";
import {
	EvalAgentsEditor,
	type EvalAgentsStore,
	runAgentsOf,
} from "./eval-agents";

describe("EvalAgentsEditor", () => {
	it("saves an added pick, showing it once the server has it", async () => {
		const kept = store();
		const editor = new EvalAgentsEditor(kept);
		await editor.load();

		editor.add("claude", "opus");

		expect(editor.picks).toEqual([]);
		expect(editor.saving).toBe(true);
		await Promise.resolve();
		await Promise.resolve();
		expect(editor.picks).toEqual([{ agent: "claude", model: "opus" }]);
		expect(editor.saving).toBe(false);
		expect(kept.saved).toEqual([[{ agent: "claude", model: "opus" }]]);
	});

	it("names one model at two thinking levels", async () => {
		const editor = new EvalAgentsEditor(store());
		await editor.load();

		const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
		editor.add("claude", "opus");
		await settled();
		editor.setEffort(0, "low");
		await settled();
		editor.add("claude", "opus");
		await settled();
		editor.setEffort(1, "low");
		await settled();

		expect(editor.picks).toEqual([
			{ agent: "claude", model: "opus", effort: "low" },
			{ agent: "claude", model: "opus" },
		]);
	});

	it("keeps the saved list, saying why, when the server refuses", async () => {
		const editor = new EvalAgentsEditor(store({ fail: true }));
		await editor.load();

		editor.add("claude", "opus");
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(editor.picks).toEqual([]);
		expect(editor.problem).toBe("refused");
	});
});

const ROSTER: EvalAgentsView["roster"] = [
	{
		id: "claude",
		name: "Claude",
		models: [{ id: "opus", name: "Opus" }],
		efforts: ["low", "high"],
	},
];

function store(
	opts: { fail?: boolean } = {},
): EvalAgentsStore & { saved: AgentPick[][] } {
	const saved: AgentPick[][] = [];
	return {
		saved,
		read: async () => ({ agents: [], problem: null, roster: ROSTER }),
		save: async (agents) => {
			if (opts.fail) {
				throw new Error("refused");
			}
			saved.push(agents);
			return { agents, problem: null, roster: ROSTER };
		},
	};
}

describe("runAgentsOf", () => {
	it("starts from the saved agents and edits without saving them", async () => {
		const kept = store();
		const saved = new EvalAgentsEditor(kept);
		await saved.load();
		saved.add("claude", "opus");
		await new Promise((resolve) => setTimeout(resolve, 0));
		kept.saved.length = 0;

		const run = runAgentsOf(saved);
		await run.load();
		expect(run.picks).toEqual([{ agent: "claude", model: "opus" }]);
		run.setEffort(0, "low");
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(run.picks).toEqual([
			{ agent: "claude", model: "opus", effort: "low" },
		]);
		expect(saved.picks).toEqual([{ agent: "claude", model: "opus" }]);
		expect(kept.saved).toEqual([]);
	});
});
