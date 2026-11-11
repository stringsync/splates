import { describe, expect, test } from "bun:test";
import { NoopElsewhereBoards } from "./noop-elsewhere-boards";

describe("NoopElsewhereBoards", () => {
	test("finds no project, task or follower", async () => {
		const boards = new NoopElsewhereBoards();

		expect([
			await boards.root("wren"),
			await boards.find("/a/wren", 4),
			await boards.following("/a/wren"),
			await boards.openTasks("/a/wren"),
		]).toEqual([null, null, [], []]);
	});

	test("names a project by its directory", async () => {
		const boards = new NoopElsewhereBoards();

		expect(await boards.slug("/a/wren")).toBe("wren");
	});
});
