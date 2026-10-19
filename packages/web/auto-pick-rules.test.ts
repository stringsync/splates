import { describe, expect, it } from "bun:test";
import type {
	AutoPickRules,
	AutoPickRulesView,
} from "@stringsync/splates-server/auto-pick";
import { DEFAULT_RULES } from "@stringsync/splates-server/auto-pick/browser";
import { RulesEditor, type RulesStore } from "./auto-pick-rules";

describe("RulesEditor", () => {
	it("drops a model and thinking level the new agent does not offer, keeping one it does", async () => {
		const editor = new RulesEditor(new FakeRulesStore());
		await editor.load();

		editor.setAgent(0, 0, "codex");

		// Codex has not said which levels it takes, so the usual three stand in.
		expect(editor.draft.rules[0]?.picks).toEqual([{ agent: "codex" }]);
		editor.setEffort(0, 0, "high");
		editor.setAgent(0, 0, "claude");
		expect(editor.draft.rules[0]?.picks).toEqual([
			{ agent: "claude", effort: "high" },
		]);
	});

	it("never changes the last rule's matchers or removes it", async () => {
		const editor = new RulesEditor(new FakeRulesStore());
		await editor.load();

		editor.setKind(0, "lookup");
		editor.removeRule(0);

		expect(editor.draft).toEqual(VIEW.rules);
		expect(editor.dirty).toBe(false);
	});

	it("refuses rules that do not check out without sending them", async () => {
		const store = new FakeRulesStore();
		const editor = new RulesEditor(store);
		await editor.load();

		editor.removePick(0, 0);

		expect(editor.problem).toBe(
			"rules.0.picks: a rule picks at least one agent",
		);
		await expect(editor.save()).rejects.toThrow(
			"rules.0.picks: a rule picks at least one agent",
		);
		expect(store.saved).toEqual([]);
	});

	it("shows a reset at once, and puts the rules back when it is refused", async () => {
		const store = new FakeRulesStore();
		const editor = new RulesEditor(store);
		await editor.load();
		editor.setPercent(80);
		store.refusal = "the disk is full";

		const resetting = editor.reset();
		expect(editor.draft).toEqual(DEFAULT_RULES);

		await expect(resetting).rejects.toThrow("the disk is full");
		expect(editor.draft.threshold).toBe(0.8);
		expect(editor.saved).toEqual(VIEW.rules);
	});
});

const VIEW: AutoPickRulesView = {
	rules: {
		format: 1,
		threshold: 0.5,
		rules: [
			{
				kind: "*",
				difficulty: "*",
				picks: [{ agent: "claude", model: "opus", effort: "max" }],
			},
		],
	},
	problem: null,
	agents: [
		{
			id: "claude",
			name: "Claude",
			models: [{ id: "opus", name: "Opus" }],
			efforts: ["low", "high", "max"],
		},
		{ id: "codex", name: "Codex", models: [], efforts: null },
	],
};

/** A store that reads `VIEW`, and saves and resets as `refusal` says: refusing with it when set. */
class FakeRulesStore implements RulesStore {
	refusal: string | null = null;
	readonly saved: AutoPickRules[] = [];

	async read(): Promise<AutoPickRulesView> {
		return VIEW;
	}

	async save(rules: AutoPickRules): Promise<AutoPickRulesView> {
		if (this.refusal !== null) {
			throw new Error(this.refusal);
		}
		this.saved.push(rules);
		return { ...VIEW, rules };
	}

	async reset(): Promise<AutoPickRulesView> {
		if (this.refusal !== null) {
			throw new Error(this.refusal);
		}
		return { ...VIEW, rules: DEFAULT_RULES };
	}
}
