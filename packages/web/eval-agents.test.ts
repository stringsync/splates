import { describe, expect, it } from "bun:test";
import type { EvalAgentsView } from "@stringsync/splates-server/evals/browser";
import type { AgentPick } from "@stringsync/splates-server/models";
import { EvalAgentsEditor, type EvalAgentsStore } from "./eval-agents";

describe("EvalAgentsEditor", () => {
	it("shows an added pick at once and saves it", async () => {
		const kept = store();
		const editor = new EvalAgentsEditor(kept);
		await editor.load();

		editor.add("claude", "opus");

		expect(editor.picks).toEqual([{ agent: "claude", model: "opus" }]);
		await Promise.resolve();
		expect(kept.saved).toEqual([[{ agent: "claude", model: "opus" }]]);
	});

	it("names one model at two thinking levels", async () => {
		const editor = new EvalAgentsEditor(store());
		await editor.load();

		editor.add("claude", "opus");
		editor.setEffort(0, "low");
		editor.add("claude", "opus");
		editor.setEffort(1, "low");

		expect(editor.picks).toEqual([
			{ agent: "claude", model: "opus", effort: "low" },
			{ agent: "claude", model: "opus" },
		]);
	});

	it("puts the saved list back, saying why, when the server refuses", async () => {
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
