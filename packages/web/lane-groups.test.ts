import "./register-dom";
import { describe, expect, it } from "bun:test";
import type { Needing } from "@stringsync/splates-server/plans/browser";
import { byLane, inOrder } from "./lane-groups";
import type { Nested } from "./parts";
import { conversation } from "./testing";

const tree = (id: string, task: string | null): Nested<Needing> => ({
	row: {
		conversation: conversation({ id, task }),
		task: null,
		need: { kind: "idle" },
	},
	parts: [],
});

const ids = (trees: Nested<Needing>[]) =>
	trees.map((each) => each.row.conversation?.id);

describe("byLane", () => {
	it("gathers the trees of a lane where its first was, keeping the rest in order", () => {
		const groups = byLane(
			[
				tree("a", "fix-a"),
				tree("b", "lane-one"),
				tree("c", null),
				tree("d", "lane-two"),
				tree("e", "lane-one-more"),
			],
			{ "lane-one": 1, "lane-one-more": 1, "lane-two": 2 },
		);
		expect(
			groups.map((group) => ({ lane: group.lane, trees: ids(group.trees) })),
		).toEqual([
			{ lane: null, trees: ["a"] },
			{ lane: 1, trees: ["b", "e"] },
			{ lane: null, trees: ["c"] },
			{ lane: 2, trees: ["d"] },
		]);
		expect(ids(inOrder(groups))).toEqual(["a", "b", "e", "c", "d"]);
	});

	it("leaves every tree on its own with no lane taken", () => {
		expect(
			byLane([tree("a", "fix-a"), tree("b", null)], {}).map(
				(group) => group.lane,
			),
		).toEqual([null, null]);
	});
});
