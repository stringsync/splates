import { describe, expect, it } from "bun:test";
import { Testing } from "../testing";
import { BACKLOG_LANE } from "./backlog";
import { BoardLifecycle } from "./board-lifecycle";
import { boardsOf, DEFAULT_BOARD } from "./boards";

const DEFAULT = { id: 1, name: "Default", position: 1, archived: false };

describe("boards", () => {
	it("gives a project from before boards a Default board holding every lane, Backlog first", async () => {
		await using deps = await Testing.open();
		// Lanes as an older splates wrote them: no board on any.
		await deps.tasks.store.records.write(
			"lanes",
			JSON.stringify([
				{ id: 3, name: "Editor" },
				{ id: 5, name: "Docs" },
			]),
		);

		expect(await deps.tasks.boards()).toEqual([DEFAULT]);
		expect(await deps.tasks.lanes()).toEqual([
			{ id: BACKLOG_LANE, name: "Backlog", board: DEFAULT_BOARD },
			{ id: 3, name: "Editor", board: DEFAULT_BOARD },
			{ id: 5, name: "Docs", board: DEFAULT_BOARD },
		]);
	});

	it("puts a new lane on the default board unless told otherwise", async () => {
		await using deps = await Testing.open();
		await deps.tasks.store.records.write(
			"boards",
			JSON.stringify([
				{ id: 1, name: "Default" },
				{ id: 2, name: "Site", archived: true },
			]),
		);

		const first = await deps.tasks.addLane("Editor");
		const other = await deps.tasks.addLane("Landing", 2);

		expect(first.board).toBe(DEFAULT_BOARD);
		expect(other.board).toBe(2);
		expect((await deps.tasks.lanes()).map(({ board }) => board)).toEqual([
			1, 1, 2,
		]);
		expect(
			(await deps.tasks.boards()).map(({ id, archived }) => [id, archived]),
		).toEqual([
			[1, false],
			[2, true],
		]);
		expect(deps.tasks.addLane("Lost", 9)).toBail("not_found");
	});

	it("keeps Backlog on the default board and moves a lane whose board is gone back to it", async () => {
		await using deps = await Testing.open();
		await deps.tasks.store.records.write(
			"lanes",
			JSON.stringify([
				{ id: 0, name: "Backlog", board: 4 },
				{ id: 2, name: "Orphan", board: 4 },
			]),
		);

		expect((await deps.tasks.lanes()).map(({ board }) => board)).toEqual([
			1, 1,
		]);
	});

	it("always has the default board, first when nothing is stored", () => {
		expect(boardsOf(null)).toEqual([DEFAULT]);
		expect(boardsOf([{ id: 7, name: "Site" }]).map(({ id }) => id)).toEqual([
			1, 7,
		]);
	});

	it("leaves queueing a lane as it was", async () => {
		await using deps = await Testing.open();
		const lane = await deps.tasks.addLane("Editor");
		await deps.tasks.add("a", null, { lane: lane.id });
		await deps.tasks.add("b", null, { lane: lane.id });

		const { changed } = await deps.tasks.queueLane(lane.id, true);

		expect(changed.map((task) => task.id)).toEqual([1, 2]);
		expect(
			(await deps.tasks.queueLane(lane.id, false)).changed.map(
				(task) => task.id,
			),
		).toEqual([1, 2]);
	});

	it("adds a board after the others and renames it, refusing a name in use", async () => {
		await using deps = await Testing.open();

		const added = await deps.tasks.addBoard(" Site ");
		expect(added).toMatchObject({ id: 2, name: "Site", position: 2 });
		await deps.tasks.renameBoard(2, "Marketing");
		expect((await deps.tasks.boards()).map((each) => each.name)).toEqual([
			"Default",
			"Marketing",
		]);
		expect(deps.tasks.addBoard("default")).rejects.toThrow();
		expect(deps.tasks.renameBoard(9, "X")).rejects.toThrow();
	});

	const open = async () => {
		const deps = await Testing.open();
		await deps.tasks.store.records.write(
			"boards",
			JSON.stringify([
				{ id: 1, name: "Default" },
				{ id: 2, name: "Site" },
			]),
		);
		const first = await deps.tasks.addLane("A");
		const second = await deps.tasks.addLane("B");
		const third = await deps.tasks.addLane("C", 2);
		return { deps, first, second, third };
	};

	it("moves a lane to another board, last or at a position, keeping its tasks", async () => {
		const { deps, first, second, third } = await open();
		await using _ = deps;
		await deps.tasks.add("x", null, { lane: first.id });

		await deps.tasks.moveLane(first.id, undefined, 2);
		expect(
			(await deps.tasks.lanes()).map(({ id, board }) => [id, board]),
		).toEqual([
			[BACKLOG_LANE, 1],
			[second.id, 1],
			[third.id, 2],
			[first.id, 2],
		]);
		await deps.tasks.moveLane(second.id, 1, 2);
		expect(
			(await deps.tasks.lanes())
				.filter(({ board }) => board === 2)
				.map(({ id }) => id),
		).toEqual([second.id, third.id, first.id]);
		expect((await deps.tasks.all())[0]?.state.lane).toBe(first.id);
	});

	it("keeps Backlog first and refuses moving it or to a missing board", async () => {
		const { deps, first } = await open();
		await using _ = deps;

		await deps.tasks.moveLane(first.id, 1);
		expect((await deps.tasks.lanes())[0]?.id).toBe(BACKLOG_LANE);
		await expect(deps.tasks.moveLane(BACKLOG_LANE, 1, 2)).toBail("usage");
		await expect(deps.tasks.moveLane(first.id, 1, 9)).toBail("not_found");
	});

	it("reorders boards", async () => {
		const { deps } = await open();
		await using _ = deps;

		const order = await deps.tasks.moveBoard(2, 1);

		expect(order.map(({ id, position }) => [id, position])).toEqual([
			[2, 1],
			[1, 2],
		]);
		expect((await deps.tasks.boards()).map(({ id }) => id)).toEqual([2, 1]);
		await expect(deps.tasks.moveBoard(9, 1)).toBail("not_found");
	});

	it("archives a board and restores it, leaving its lanes in place", async () => {
		const { deps, third } = await open();
		await using _ = deps;

		expect((await new BoardLifecycle(deps.tasks).archive(2)).archived).toBe(
			true,
		);
		expect(
			(await deps.tasks.boards()).find((each) => each.id === 2)?.archived,
		).toBe(true);
		expect(
			(await deps.tasks.lanes()).find((each) => each.id === third.id)?.board,
		).toBe(2);
		expect((await new BoardLifecycle(deps.tasks).restore(2)).archived).toBe(
			false,
		);
	});

	it("never archives or deletes the default board", async () => {
		const { deps } = await open();
		await using _ = deps;

		await expect(new BoardLifecycle(deps.tasks).archive(1)).toBail("usage");
		await expect(new BoardLifecycle(deps.tasks).delete(1)).toBail("usage");
	});

	it("deletes an empty board with its empty lanes", async () => {
		const { deps, third } = await open();
		await using _ = deps;

		await new BoardLifecycle(deps.tasks).delete(2);

		expect((await deps.tasks.boards()).map((each) => each.id)).toEqual([1]);
		expect(
			(await deps.tasks.lanes()).some((each) => each.id === third.id),
		).toBe(false);
	});

	it("refuses to delete a board whose lanes hold tasks, saying to move the lanes first", async () => {
		const { deps, third } = await open();
		await using _ = deps;
		await deps.tasks.add("Hero", null, { lane: third.id });

		await expect(new BoardLifecycle(deps.tasks).delete(2)).toBail("usage");
		expect((await deps.tasks.boards()).map((each) => each.id)).toEqual([1, 2]);
	});
});
