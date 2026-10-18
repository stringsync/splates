import { describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import type { Limit, Setting } from "../conversations";
import { type PickInput, pick } from "./auto-pick";
import { DEFAULT_AGENTS } from "./roster";
import type { Judge, Judgment } from "./system-one";

describe("pick", () => {
	it("asks the judge about the prompt alone", async () => {
		const judge = new FakeJudge({ mechanical: 0.9 });
		await pick(input({ judge }));
		expect(judge.asked).toHaveLength(1);
		expect(judge.asked[0]?.state).toEqual({
			prompt: "Rename `foo` to `bar` in src/util.ts",
		});
		expect(Object.keys(judge.asked[0]?.questions ?? {})).toEqual([
			"lookup",
			"mechanical",
			"design",
			"broad",
			"open",
		]);
	});

	it("picks the cheapest model that meets the tier, with a low effort for light work", async () => {
		const picked = await pick(
			input({ judge: new FakeJudge({ mechanical: 0.9 }) }),
		);
		expect(picked).toMatchObject({
			agent: "claude",
			model: "haiku",
			effort: "low",
		});
		expect(picked.reasons[0]).toBe("Haiku 5.5, low effort");
		expect(picked.reasons).toContain("judged: a well-specified edit");
		expect(picked.signs).toEqual(["a well-specified edit"]);
	});

	it("picks a stronger model and more thinking for a design decision", async () => {
		const picked = await pick(
			input({ judge: new FakeJudge({ design: 0.9, broad: 0.9, open: 0.9 }) }),
		);
		expect(picked).toMatchObject({ model: "fable", effort: "high" });
	});

	it("thinks one level harder when the judge is unsure", async () => {
		const picked = await pick(
			input({
				judge: new FakeJudge({
					lookup: 0.55,
					mechanical: 0.45,
					design: 0.45,
					broad: 0.45,
					open: 0.45,
				}),
			}),
		);
		expect(picked).toMatchObject({ model: "haiku", effort: "medium" });
		expect(picked.reasons).toContain(
			"the judge was unsure, so one thinking level higher",
		);
	});

	it("picks among only the agents that have run here, on models they offer", async () => {
		const cheapest = await pick(
			input({ offered: OFFERED, judge: new FakeJudge({ design: 0.9 }) }),
		);
		// Astra and Opus rank the same, with no plan used; the roster lists Claude first.
		expect(cheapest).toMatchObject({ agent: "claude", model: "opus" });

		const codexOnly = await pick(
			input({
				offered: { codex: OFFERED.codex ?? [] },
				judge: new FakeJudge({ design: 0.9 }),
			}),
		);
		expect(codexOnly).toMatchObject({
			agent: "codex",
			model: "gpt-6-astra",
			effort: "medium",
		});

		const noHaiku = await pick(
			input({
				offered: { claude: [select("model", "model", ["opus", "sonnet"])] },
				judge: new FakeJudge({ lookup: 0.9 }),
			}),
		);
		expect(noHaiku).toMatchObject({ agent: "claude", model: "sonnet" });
		expect(noHaiku.effort).toBeUndefined();
	});

	it("sends middle-tier work to Codex's Sol when it is the only agent", async () => {
		const picked = await pick(
			input({
				offered: {
					codex: [
						select("model", "model", [
							"gpt-6-astra",
							"gpt-6.1-sol",
							"gpt-6-luna",
						]),
						select("reasoning_effort", "thought_level", ["low", "medium"]),
					],
				},
				judge: new FakeJudge(),
			}),
		);
		expect(picked).toMatchObject({ agent: "codex", model: "gpt-6.1-sol" });
	});

	it("breaks a tie between agents toward the one with more plan left", async () => {
		const limits = {
			claude: [limit("five_hour", 0.56), limit("seven_day", 0.1)],
			codex: [limit("seven_day", 0.09)],
		};
		const heavy = await pick(
			input({
				offered: OFFERED,
				judge: new FakeJudge({ design: 0.9 }),
				limits,
			}),
		);
		expect(heavy).toMatchObject({ agent: "codex", model: "gpt-6-astra" });
		expect(heavy.reasons).toContain(
			"over Opus 5.5, which ranks the same: Claude has 56% of five_hour used",
		);

		const light = await pick(
			input({
				offered: OFFERED,
				judge: new FakeJudge({ lookup: 0.9 }),
				limits,
			}),
		);
		expect(light).toMatchObject({ agent: "codex", model: "gpt-6-luna" });

		const between = await pick(
			input({ offered: OFFERED, judge: new FakeJudge(), limits }),
		);
		expect(between).toMatchObject({ agent: "claude", model: "sonnet" });

		const codexBusier = await pick(
			input({
				offered: OFFERED,
				judge: new FakeJudge({ design: 0.9 }),
				limits: {
					claude: [limit("seven_day", 0.1)],
					codex: [limit("seven_day", 0.5)],
				},
			}),
		);
		expect(codexBusier).toMatchObject({ agent: "claude", model: "opus" });
	});

	it("takes the strongest model left when none meets the tier", async () => {
		const picked = await pick(
			input({
				offered: { claude: [select("model", "model", ["sonnet", "haiku"])] },
				judge: new FakeJudge({ design: 0.9, broad: 0.9, open: 0.9 }),
			}),
		);
		expect(picked).toMatchObject({ model: "sonnet" });
	});

	it("goes a tier lighter on an agent whose plan is nearly used up", async () => {
		const picked = await pick(
			input({
				judge: new FakeJudge({ design: 0.9 }),
				limits: { claude: [limit("five_hour", 0.85), limit("seven_day", 0.3)] },
			}),
		);
		expect(picked).toMatchObject({ model: "sonnet" });
		expect(picked.reasons).toContain(
			"a tier lighter on Claude: 85% of five_hour used",
		);
	});

	it("ignores a window that has already reset", async () => {
		const picked = await pick(
			input({
				judge: new FakeJudge({ design: 0.9 }),
				limits: { claude: [limit("five_hour", 0.99, "2026-10-17T09:00:00Z")] },
			}),
		);
		expect(picked).toMatchObject({ model: "opus" });
	});

	it("passes over an agent whose plan is spent while another is left", async () => {
		const picked = await pick(
			input({
				offered: OFFERED,
				judge: new FakeJudge({ design: 0.9 }),
				limits: { claude: [limit("seven_day", 0.97)] },
			}),
		);
		expect(picked).toMatchObject({ agent: "codex", model: "gpt-6-astra" });
		expect(picked.reasons).toContain(
			"passed over Claude: 97% of seven_day used",
		);

		const alone = await pick(
			input({
				judge: new FakeJudge({ design: 0.9 }),
				limits: { claude: [limit("seven_day", 0.97)] },
			}),
		);
		expect(alone).toMatchObject({ agent: "claude", model: "sonnet" });
	});

	it("falls back to the default weight, on the agent's default effort, with no judge", async () => {
		const picked = await pick(input({ judge: null }));
		expect(picked).toEqual({
			agent: "claude",
			model: "opus",
			reasons: [
				"Opus 5.5",
				"no judge: keep TYPESAFE_API_KEY for Jev, or CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN for Clef",
				"needs tier 3 of 4",
			],
		});
	});

	it("falls back when the judge fails", async () => {
		const picked = await pick(
			input({
				judge: {
					judge: () => Promise.reject(new Error("Jev answered 401")),
				},
			}),
		);
		expect(picked).toMatchObject({ model: "opus" });
		expect(picked.reasons).toContain(
			"the judge failed (Jev answered 401), so the default weight",
		);
	});

	it("falls back when the judge is slow, even one that ignores its signal", async () => {
		const picked = await pick(
			input({
				timeout: Duration.ms(10),
				judge: { judge: () => new Promise(() => {}) },
			}),
		);
		expect(picked).toMatchObject({ model: "opus" });
		expect(picked.reasons).toContain(
			"the judge took over 0.01s, so the default weight",
		);
	});

	it("gives up when its caller aborts", async () => {
		const controller = new AbortController();
		controller.abort(new Error("closed"));
		await expect(
			pick(
				input({
					signal: controller.signal,
					judge: { judge: () => new Promise(() => {}) },
				}),
			),
		).rejects.toThrow("closed");
	});

	it("picks from the whole roster before any agent has run here", async () => {
		const picked = await pick(
			input({ offered: {}, judge: new FakeJudge({ lookup: 0.9 }) }),
		);
		expect(picked).toMatchObject({ agent: "claude", model: "haiku" });
		expect(picked.effort).toBeUndefined();
		expect(picked.reasons).toContain(
			"no agent has run on this machine yet, so any on the roster",
		);
	});

	it("starts an agent the roster ranks no model of on its default", async () => {
		const picked = await pick(
			input({
				agents: [
					{
						id: "opencode",
						name: "OpenCode",
						argv: ["opencode", "acp"],
						models: [],
					},
				],
				offered: {},
			}),
		);
		expect(picked).toMatchObject({ agent: "opencode" });
		expect(picked.model).toBeUndefined();
	});
});

const NOW = new Date("2026-10-17T10:00:00Z");

/** Answers each question as `answers` says, a firm no otherwise, and records what it was asked. */
class FakeJudge implements Judge {
	readonly asked: Judgment[] = [];
	constructor(private readonly answers: Record<string, number> = {}) {}
	async judge(judgment: Judgment) {
		this.asked.push(judgment);
		return {
			answers: new Map(
				Object.keys(judgment.questions).map((id) => [
					id,
					this.answers[id] ?? 0,
				]),
			),
		};
	}
}

function select(id: string, category: string, values: string[]): Setting {
	return {
		id,
		name: id,
		type: "select",
		category,
		current: values[0] ?? "",
		options: values.map((value) => ({ value, name: value, description: null })),
	};
}

/** What each agent offers, as `offered.json` keeps it after a run. */
const OFFERED: Record<string, Setting[]> = {
	claude: [
		select("model", "model", ["default", "opus", "fable", "sonnet", "haiku"]),
		select("effort", "thought_level", ["default", "low", "medium", "high"]),
	],
	codex: [
		select("model", "model", ["gpt-6-astra", "gpt-6-luna"]),
		select("reasoning_effort", "thought_level", ["low", "medium", "high"]),
	],
};

function limit(
	window: string,
	used: number,
	resets = "2026-10-17T15:00:00Z",
): Limit {
	return { window, used, resets, at: null };
}

function input(over: Partial<PickInput> = {}): PickInput {
	return {
		prompt: "Rename `foo` to `bar` in src/util.ts",
		agents: DEFAULT_AGENTS,
		offered: { claude: OFFERED.claude ?? [] },
		limits: {},
		judge: new FakeJudge(),
		now: NOW,
		...over,
	};
}
