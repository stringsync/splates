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
