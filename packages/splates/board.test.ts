import { expect, it } from "bun:test";
import { Testing } from "@splates/server/testing";
import { splates } from "./splates";

it("lets an agent manage boards and place lanes on them, deleting only empty boards", async () => {
	await using testing = await Testing.open();
	testing.ps.cd(testing.root);
	testing.proc.env.SPLATES_CONVERSATION = "agent";
	const deps = {
		log: testing.log,
		fs: testing.fs,
		ps: testing.ps,
		assets: testing.assets,
		secrets: testing.secrets,
	};
	await splates.run(deps, ["board", "add", "Launch"]);
	await splates.run(deps, ["board", "add", "Later"]);
	await splates.run(deps, ["board", "update", "3", "--position", "2"]);
	await splates.run(deps, ["board", "update", "2", "--name", "Ship"]);
	await splates.run(deps, ["board", "update", "3", "--archived"]);
	expect(
		(await testing.tasks.boards()).map((board) => [
			board.id,
			board.name,
			board.archived,
		]),
	).toEqual([
		[1, "Default", false],
		[3, "Later", true],
		[2, "Ship", false],
	]);

	await splates.run(deps, ["lane", "add", "Docs", "--board", "2"]);
	expect(
		(await testing.tasks.lanes()).find((lane) => lane.id === 1)?.board,
	).toBe(2);
	await splates.run(deps, ["lane", "add", "More"]);
	await splates.run(deps, ["lane", "update", "2", "--board", "2"]);
	expect(
		(await testing.tasks.lanes()).find((lane) => lane.id === 2)?.board,
	).toBe(2);

	await splates.run(deps, [
		"task",
		"add",
		"Keep me",
		"--slug",
		"keep-me",
		"--lane",
		"1",
	]);
	testing.log.clear();
	await splates.run(deps, ["board", "remove", "2"]);
	expect(testing.out()).toContain('"reason":"usage"');
	expect((await testing.tasks.boards()).some((board) => board.id === 2)).toBe(
		true,
	);

	testing.log.clear();
	await splates.run(deps, ["board", "remove", "1"]);
	expect(testing.out()).toContain('"reason":"usage"');

	await splates.run(deps, ["board", "remove", "3"]);
	expect((await testing.tasks.boards()).some((board) => board.id === 3)).toBe(
		false,
	);

	testing.log.clear();
	await splates.run(deps, ["board", "list", "--json"]);
	expect(JSON.parse(testing.out())).toMatchObject([
		{ board: 1 },
		{ board: 2, lanes: [1, 2] },
	]);
});
