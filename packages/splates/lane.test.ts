import { expect, it } from "bun:test";
import { Testing } from "@stringsync/splates-server/testing";
import { splates } from "./splates";

it("addresses permanent Backlog by name in both task and lane commands", async () => {
	await using testing = await Testing.open();
	testing.ps.cd(testing.root);
	const deps = {
		log: testing.log,
		fs: testing.fs,
		ps: testing.ps,
		assets: testing.assets,
		secrets: testing.secrets,
	};
	await splates.run(deps, [
		"task",
		"defer",
		"later",
		"--slug",
		"later",
		"--lane",
		"backlog",
	]);
	const [task] = await testing.tasks.all();
	expect(task?.lane, testing.out()).toBe(0);
	testing.log.clear();
	await splates.run(deps, ["lane", "show", "backlog", "--json"]);
	expect(JSON.parse(testing.out())).toMatchObject({ lane: 0, name: "Backlog" });
});

it(`lets SPLATES_CONVERSATION add and remove empty lanes but keeps lanes containing tasks`, async () => {
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
	await splates.run(deps, ["lane", "add", "Empty"]);
	expect((await testing.tasks.lanes()).some((lane) => lane.id === 1)).toBe(
		true,
	);
	await splates.run(deps, ["lane", "remove", "1"]);
	expect((await testing.tasks.lanes()).some((lane) => lane.id === 1)).toBe(
		false,
	);
	expect(testing.out()).toContain("removed empty lane 1");

	await splates.run(deps, ["lane", "add", "Occupied"]);
	await splates.run(deps, [
		"task",
		"add",
		"Keep me",
		"--slug",
		"keep-me",
		"--lane",
		"2",
	]);
	testing.log.clear();
	await splates.run(deps, ["lane", "remove", "2"]);
	expect(testing.out()).toContain('"reason":"usage"');
	expect(testing.out()).toContain("contains tasks");
	expect((await testing.tasks.lanes()).some((lane) => lane.id === 2)).toBe(
		true,
	);
	expect((await testing.tasks.all()).map((task) => task.state.lane)).toEqual([
		2,
	]);

	testing.log.clear();
	await splates.run(deps, ["lane", "remove", "backlog"]);
	expect(testing.out()).toContain('"reason":"usage"');
	expect((await testing.tasks.lanes()).some((lane) => lane.id === 0)).toBe(
		true,
	);
});

it(`lets SPLATES_STARTED_BY add and remove empty lanes but keeps lanes containing tasks`, async () => {
	await using testing = await Testing.open();
	testing.ps.cd(testing.root);
	testing.proc.env.SPLATES_STARTED_BY = "agent";
	const deps = {
		log: testing.log,
		fs: testing.fs,
		ps: testing.ps,
		assets: testing.assets,
		secrets: testing.secrets,
	};
	await splates.run(deps, ["lane", "add", "Empty"]);
	expect((await testing.tasks.lanes()).some((lane) => lane.id === 1)).toBe(
		true,
	);
	await splates.run(deps, ["lane", "remove", "1"]);
	expect((await testing.tasks.lanes()).some((lane) => lane.id === 1)).toBe(
		false,
	);
	expect(testing.out()).toContain("removed empty lane 1");

	await splates.run(deps, ["lane", "add", "Occupied"]);
	await splates.run(deps, [
		"task",
		"add",
		"Keep me",
		"--slug",
		"keep-me",
		"--lane",
		"2",
	]);
	testing.log.clear();
	await splates.run(deps, ["lane", "remove", "2"]);
	expect(testing.out()).toContain('"reason":"usage"');
	expect(testing.out()).toContain("contains tasks");
	expect((await testing.tasks.lanes()).some((lane) => lane.id === 2)).toBe(
		true,
	);
	expect((await testing.tasks.all()).map((task) => task.state.lane)).toEqual([
		2,
	]);

	testing.log.clear();
	await splates.run(deps, ["lane", "remove", "backlog"]);
	expect(testing.out()).toContain('"reason":"usage"');
	expect((await testing.tasks.lanes()).some((lane) => lane.id === 0)).toBe(
		true,
	);
});
