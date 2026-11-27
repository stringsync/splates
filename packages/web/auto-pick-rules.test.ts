import { describe, expect, it } from "bun:test";
import type {
	AutoPickRules,
	AutoPickRulesView,
} from "@splates/server/auto-pick";
import { DEFAULT_PACE, DEFAULT_RULES } from "@splates/server/auto-pick/browser";
import { routedTo } from "@splates/server/auto-pick/testing";
import { RulesEditor, type RulesStore } from "./auto-pick-rules";

describe("RulesEditor", () => {
	it("adds a pick at the thinking level the lineup's others take, once", async () => {
		const editor = new RulesEditor(new FakeRulesStore());
		await editor.load();

		editor.addPick("main", "codex", undefined);
		editor.addPick("main", "codex", undefined);
		editor.addPick("main", "claude", "opus");

		// Codex has not said which levels it takes, so the usual three stand in
		// and `max` is not among them.
		expect(editor.lineup("main")?.picks).toEqual([
			{ agent: "claude", model: "opus", effort: "max" },
			{ agent: "codex" },
		]);
		expect(editor.has("main", "codex", undefined)).toBe(true);
	});

	it("moves picks and prevents a second pick of the same agent", async () => {
		const editor = new RulesEditor(new FakeRulesStore());
		await editor.load();
		editor.addPick("main", "codex", undefined);
		editor.addPick("main", "claude", undefined);
		editor.addPick("main", "claude", "sonnet");
		expect(editor.lineup("main")?.picks).toHaveLength(2);
		expect(editor.has("main", "claude", "sonnet")).toBe(true);
		editor.movePick("main", 1, 0);
		expect(editor.lineup("main")?.picks.map((each) => each.agent)).toEqual([
			"codex",
			"claude",
		]);
		editor.setModel("main", 0, "claude", "sonnet");
		expect(editor.lineup("main")?.picks[0]?.agent).toBe("codex");
		editor.setModel("main", 1, "claude", "sonnet");
		expect(editor.lineup("main")?.picks[1]?.model).toBe("sonnet");
	});

	it("adds Antigravity's Claude after its Gemini, each plan once", async () => {
		const editor = new RulesEditor(new FakeRulesStore());
		await editor.load();
		editor.addPick("main", "antigravity", "gemini-4-neon");
		expect(editor.has("main", "antigravity", "gemini-4-carbon")).toBe(true);
		expect(editor.has("main", "antigravity", undefined)).toBe(true);
		expect(editor.has("main", "antigravity", "claude-opus-5-5")).toBe(false);
		editor.addPick("main", "antigravity", "claude-opus-5-5");
		editor.addPick("main", "antigravity", "claude-sonnet-5-5");
		expect(editor.lineup("main")?.picks.map((each) => each.model)).toEqual([
			"opus",
			"gemini-4-neon",
			"claude-opus-5-5",
		]);
	});

	it("changes a pick to another agent, keeping a thinking level it offers", async () => {
		const editor = new RulesEditor(new FakeRulesStore());
		await editor.load();
		editor.setEffort("main", 0, "high");

		editor.setModel("main", 0, "codex", undefined);
		expect(editor.lineup("main")?.picks).toEqual([
			{ agent: "codex", effort: "high" },
		]);
		editor.setEffort("main", 0, "max");
		editor.setModel("main", 0, "claude", "opus");
		expect(editor.lineup("main")?.picks).toEqual([
			{ agent: "claude", model: "opus", effort: "max" },
		]);
	});

	it("sends cells to a lineup, and deletes a lineup only once no cell uses it", async () => {
		const editor = new RulesEditor(new FakeRulesStore());
		await editor.load();
		expect(editor.uses("spare")).toEqual([]);

		editor.send(
			[
				{ kind: "bugfix", depth: "deep" },
				{ kind: "unsure", depth: "unsure" },
			],
			"spare",
		);
		expect(editor.lineupOf({ kind: "bugfix", depth: "deep" })?.name).toBe(
			"Spare",
		);
		expect(editor.uses("spare")).toHaveLength(2);
		editor.removeLineup("spare");
		expect(editor.lineup("spare")).toBeDefined();

		editor.send(editor.uses("spare"), "main");
		editor.removeLineup("spare");
		expect(editor.lineup("spare")).toBeUndefined();
		expect(editor.problem).toBeNull();
	});

	it("adds a lineup with a name and a color no other has", async () => {
		const editor = new RulesEditor(new FakeRulesStore());
		await editor.load();

		const first = editor.addLineup();
		const second = editor.addLineup();
		expect(editor.lineup(first)).toEqual({
			id: "new-lineup",
			name: "New lineup",
			color: "violet",
			picks: [{ agent: "claude", model: "opus" }],
		});
		expect(editor.lineup(second)).toMatchObject({
			id: "new-lineup-2",
			name: "New lineup 2",
			color: "pink",
		});
		editor.rename(first, "Night shift");
		editor.recolor(first, "slate");
		expect(editor.lineup(first)).toMatchObject({
			id: "new-lineup",
			name: "Night shift",
			color: "slate",
		});
	});

	it("says what does not check out, and sends nothing", async () => {
		const store = new FakeRulesStore();
		const editor = new RulesEditor(store);
		await editor.load();
		editor.rename("spare", "main");

		expect(editor.problem).toBe("lineups.1.name: two lineups are named 'main'");
		expect(editor.save()).rejects.toThrow("two lineups are named 'main'");
		expect(store.saved).toEqual([]);
	});

	it("never removes a lineup's last pick", async () => {
		const editor = new RulesEditor(new FakeRulesStore());
		await editor.load();

		editor.removePick("main", 0);

		expect(editor.draft).toEqual(VIEW.rules);
	});

	it("drops every edit on discard", async () => {
		const editor = new RulesEditor(new FakeRulesStore());
		await editor.load();
		editor.send([{ kind: "open", depth: "shallow" }], "spare");
		expect(editor.dirty).toBe(true);

		editor.discard();
		expect(editor.dirty).toBe(false);
		expect(editor.draft).toEqual(VIEW.rules);
	});

	it("marks a reset saving, and keeps the draft when it is refused", async () => {
		const store = new FakeRulesStore();
		const editor = new RulesEditor(store);
		await editor.load();
		editor.setPercent(80);
		store.refusal = "the disk is full";

		const resetting = editor.reset();
		expect(editor.saving).toBe(true);
		expect(editor.draft.threshold).toBe(0.8);

		expect(resetting).rejects.toThrow("the disk is full");
		expect(editor.saving).toBe(false);
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
	it("applies sections independently, retaining unrelated drafts", async () => {
		const store = new FakeRulesStore();
		const editor = new RulesEditor(store);
		await editor.load();
		editor.rename("main", "Renamed");
		editor.setPercent(75);
		editor.send([{ kind: "bugfix", depth: "deep" }], "spare");
		await editor.apply("routes");
		expect(store.saved[0]?.lineups[0]?.name).toBe("Main");
		expect(store.saved[0]?.threshold).toBe(VIEW.rules.threshold);
		expect(editor.lineup("main")?.name).toBe("Renamed");
		expect(editor.percent).toBe(75);
		await editor.apply({ lineup: "main" });
		expect(store.saved[1]?.lineups[0]?.name).toBe("Renamed");
		expect(store.saved[1]?.threshold).toBe(VIEW.rules.threshold);
		expect(store.saved[1]?.routes.bugfix.deep).toBe("spare");
		await editor.apply("settings");
		expect(editor.dirty).toBe(false);
	});
	it("retains drafts after refusal and cancels just one lineup", async () => {
		const store = new FakeRulesStore();
		const editor = new RulesEditor(store);
		await editor.load();
		editor.rename("main", "Renamed");
		editor.setPercent(75);
		store.refusal = "offline";
		await editor
			.apply({ lineup: "main" })
			.catch((error: Error) => expect(error.message).toBe("offline"));
		expect(editor.lineup("main")?.name).toBe("Renamed");
		editor.discardLineup("main");
		expect(editor.lineup("main")?.name).toBe("Main");
		expect(editor.percent).toBe(75);
		await editor
			.deleteLineup("spare")
			.catch((error: Error) => expect(error.message).toBe("offline"));
		expect(editor.lineup("spare")).toBeDefined();
		expect(editor.percent).toBe(75);
	});
	it("a failed cell assignment cannot leak into the next batch", async () => {
		const store = new FakeRulesStore();
		const editor = new RulesEditor(store);
		await editor.load();
		store.refusal = "offline";
		await editor
			.apply({ cells: [{ kind: "bugfix", depth: "deep" }], lineup: "spare" })
			.catch((error: Error) => expect(error.message).toBe("offline"));
		expect(editor.dirty).toBe(false);
		store.refusal = null;
		await editor.apply({
			cells: [{ kind: "design", depth: "shallow" }],
			lineup: "spare",
		});
		expect(editor.saved?.routes.bugfix.deep).toBe("main");
		expect(editor.saved?.routes.design.shallow).toBe("spare");
	});
});

const { pace: _, ...UNPACED } = routedTo([{ agent: "claude" }], "main");

const VIEW: AutoPickRulesView = {
	rules: {
		...UNPACED,
		lineups: [
			{
				id: "main",
				name: "Main",
				color: "emerald",
				picks: [{ agent: "claude", model: "opus", effort: "max" }],
			},
			{
				id: "spare",
				name: "Spare",
				color: "sky",
				picks: [{ agent: "codex" }],
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
