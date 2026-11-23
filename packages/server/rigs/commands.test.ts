import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { NodePs } from "core/system";
import { RigCommands } from "./commands";

const fixture = `bun ${join(import.meta.dir, "fixtures/rig.ts")}`;

describe("RigCommands", () => {
	it("reads each command's rigs from its describe, with defaults filled in", async () => {
		const rigs = new RigCommands([fixture], new NodePs(), import.meta.dir);
		const { groups, errors } = await rigs.list();
		expect(errors).toEqual([]);
		expect(groups.map((group) => [group.command, group.name])).toEqual([
			[fixture, "fixture"],
		]);
		const [echo, fail] = groups[0]?.rigs ?? [];
		expect(echo?.ports).toEqual(["web"]);
		expect(echo?.options.map((option) => option.name)).toEqual([
			"greeting",
			"loud",
			"mode",
		]);
		expect(fail?.options).toEqual([]);
	});

	it("shows a command that fails or answers wrongly as an error, keeping the rest", async () => {
		const rigs = new RigCommands(
			[fixture, "false", 'echo \'{"name":"x","rigs":[{"name":"A"}]}\' #'],
			new NodePs(),
			import.meta.dir,
		);
		const { groups, errors } = await rigs.list();
		expect(groups.map((group) => group.name)).toEqual(["fixture"]);
		expect(errors.map((each) => each.command)).toEqual([
			"false",
			'echo \'{"name":"x","rigs":[{"name":"A"}]}\' #',
		]);
		expect(errors[0]?.error).toContain('"false describe" exited 1');
		expect(errors[1]?.error).toContain("answered wrongly at rigs.0");
	});

	it("refuses a second command describing a group of the same name", async () => {
		const rigs = new RigCommands(
			[fixture, fixture],
			new NodePs(),
			import.meta.dir,
		);
		const { groups, errors } = await rigs.list();
		expect(groups).toHaveLength(1);
		expect(errors[0]?.error).toContain('"fixture" is described by');
	});
});
