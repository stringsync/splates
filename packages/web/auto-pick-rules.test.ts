import { describe, expect, it } from "bun:test";
import type {
	AutoPickRules,
	AutoPickRulesView,
} from "@stringsync/splates-server/auto-pick";
import {
	DEFAULT_PACE,
	DEFAULT_RULES,
} from "@stringsync/splates-server/auto-pick/browser";
import { RulesEditor, type RulesStore } from "./auto-pick-rules";

describe("RulesEditor", () => {
	it("adds a pick at the thinking level the rule's others take, once", async () => {
		const editor = new RulesEditor(new FakeRulesStore());
		await editor.load();

		editor.addPick(0, "codex", undefined);
		editor.addPick(0, "codex", undefined);
		editor.addPick(0, "claude", "opus");

		// Codex has not said which levels it takes, so the usual three stand in
		// and `max` is not among them.
		expect(editor.draft.rules[0]?.picks).toEqual([
			{ agent: "claude", model: "opus", effort: "max" },
			{ agent: "codex" },
		]);
		expect(editor.has(0, "codex", undefined)).toBe(true);
	});

	it("moves a pick to a place, and refuses a model another pick names", async () => {
		const editor = new RulesEditor(new FakeRulesStore());
		await editor.load();
		editor.addPick(0, "codex", undefined);
		editor.addPick(0, "claude", undefined);

		editor.movePick(0, 2, 0);
		expect(editor.draft.rules[0]?.picks.map((each) => each.model)).toEqual([
			undefined,
			"opus",
			undefined,
		]);
		editor.setModel(0, 0, "opus");
		expect(editor.draft.rules[0]?.picks[0]?.model).toBeUndefined();
	});

	it("never changes the last rule's matchers or removes it", async () => {
		const editor = new RulesEditor(new FakeRulesStore());
		await editor.load();

		editor.setKind(0, "open");
		editor.removeRule(0);

		expect(editor.draft).toEqual(VIEW.rules);
		expect(editor.dirty).toBe(false);
	});

	it("refuses rules that do not check out without sending them", async () => {
		const store = new FakeRulesStore();
		const editor = new RulesEditor(store);
		await editor.load();
		editor.draft = {
			...editor.draft,
			rules: [{ kind: "*", depth: "*", picks: [] }],
		};

		expect(editor.problem).toBe(
			"rules.0.picks: a rule picks at least one agent",
		);
		await expect(editor.save()).rejects.toThrow(
			"rules.0.picks: a rule picks at least one agent",
		);
		expect(store.saved).toEqual([]);
	});

	it("never removes a rule's last pick", async () => {
		const editor = new RulesEditor(new FakeRulesStore());
		await editor.load();

		editor.removePick(0, 0);

		expect(editor.draft).toEqual(VIEW.rules);
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

	it("edits the pace, starting from the defaults when the rules name none", async () => {
		const store = new FakeRulesStore();
		const editor = new RulesEditor(store);
		await editor.load();
		expect(editor.pace).toEqual(DEFAULT_PACE);

		editor.setPaced(false);
		editor.setSlackPercent(24.6);
		editor.setSpentPercent(120);
		expect(editor.draft.pace).toEqual({ on: false, slack: 0.25, spent: 1 });
		expect(editor.dirty).toBe(true);
		expect(editor.problem).toBeNull();
	});
});

const VIEW: AutoPickRulesView = {
	rules: {
		format: 2,
		threshold: 0.5,
		rules: [
			{
				kind: "*",
				depth: "*",
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
