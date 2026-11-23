import { describe, expect, it } from "bun:test";
import { type ChainNode, chainRows, chainStats } from "./chain-tree";

const node = (
	id: number,
	parent: number | null,
	status: ChainNode["status"] = "queued",
): ChainNode => ({
	id,
	title: `t${id}`,
	status,
	parent,
	conversation: null,
	tokens: 0,
});

describe("chain tree", () => {
	it("folds what lies below the third level under its task", () => {
		const rows = chainRows([
			node(1, null),
			node(2, 1),
			node(3, 2),
			node(4, 3),
			node(5, 3),
			node(6, 4),
			node(7, null),
		]);
		expect(
			rows.map((row) =>
				row.kind === "task"
					? `${row.depth}:#${row.node.id}`
					: `more ${row.count} under #${row.under}`,
			),
		).toEqual(["1:#1", "2:#2", "3:#3", "more 3 under #3", "1:#7"]);
	});

	it("puts a task whose parent is not in the chain at the top", () => {
		const rows = chainRows([node(9, 4)]);
		expect(rows).toEqual([{ kind: "task", node: node(9, 4), depth: 1 }]);
	});

	it("counts each status", () => {
		const stats = chainStats([
			node(1, null, "running"),
			node(2, 1, "running"),
			node(3, 1, "held"),
			node(4, 1, "merged"),
		]);
		expect(stats).toMatchObject({ running: 2, held: 1, merged: 1, queued: 0 });
	});
});
