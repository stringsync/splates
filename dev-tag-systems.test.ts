import { beforeEach, describe, expect, it } from "bun:test";
import type { Answer } from "webappwiz/decide";
import { FakeDecider } from "webappwiz/decide/testing";
import { TAG_THRESHOLDS, tagSystems } from "./dev-tag-systems";
import { SYSTEMS } from "./dev-tag-systems-testing";

const noul = (value: number): Answer => ({ type: "noul", noul: value });

const choice = (probabilities: Record<string, number>): Answer => ({
	type: "choice",
	choice: "",
	probabilities,
	confidence: 1,
});

describe("tagSystems", () => {
	let decider: FakeDecider;
	beforeEach(() => {
		decider = new FakeDecider();
	});

	it("asks nothing when the text names no system", async () => {
		expect(await tagSystems(decider, "w", SYSTEMS, "hello there")).toEqual({
			text: "hello there",
			edits: [],
		});
		expect(decider.asked).toEqual([]);
	});

	it("applies sure tags, leaves unlikely ones, and marks the rest", async () => {
		decider.answers = {
			"refers.scry": noul(0.95),
			"refers.board": noul(0.9),
			"span.0": choice({ scry: 0.95, none: 0.05 }),
			"span.1": choice({ board: 0.6, none: 0.4 }),
			"span.2": choice({ scry: 0.1, none: 0.9 }),
		};
		const text = "run scry on the board, I scry";

		const { text: tagged, edits } = await tagSystems(
			decider,
			"w",
			SYSTEMS,
			text,
		);

		expect(tagged).toBe("run #scry on the board, I scry");
		expect(edits).toEqual([
			{
				type: "tag",
				start: 17,
				end: 22,
				system: "board",
				probability: 0.9 * 0.6,
			},
		]);
		expect(tagged.slice(17, 22)).toBe("board");
		expect(decider.asked).toHaveLength(1);
	});

	it("asks a Noul per system and a Choice per span, with none to pick", async () => {
		decider.answers = {
			"refers.scry": noul(0),
			"span.0": choice({ none: 1 }),
			"span.1": choice({ none: 1 }),
		};

		await tagSystems(decider, "w", SYSTEMS, "run scry and scry again");

		const asked = decider.asked[0]?.questions ?? {};
		expect(Object.keys(asked)).toEqual(["refers.scry", "span.0", "span.1"]);
		expect(asked["span.1"]).toMatchObject({
			type: "choice",
			instructions: { phrase: "scry", where: "run scry and [scry] again" },
			criteria: { scry: expect.any(String), none: expect.any(String) },
		});
	});

	it("tags only above the apply threshold", async () => {
		decider.answers = {
			"refers.scry": noul(1),
			"span.0": choice({ scry: TAG_THRESHOLDS.apply, none: 0.2 }),
		};

		const { text, edits } = await tagSystems(decider, "w", SYSTEMS, "scry it");

		expect(text).toBe("scry it");
		expect(edits).toHaveLength(1);
	});
});
