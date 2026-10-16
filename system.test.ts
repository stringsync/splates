import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { color } from "webappwiz/log";
import { add } from "./add";
import { Exit } from "./exit";
import { systems } from "./system";
import { Testing } from "./testing";

const SYSTEMS = `export default ${JSON.stringify({
	playback: {
		description: "Playing a song",
		aliases: ["player"],
		globs: ["src/audio/**"],
		ignore: ["src/audio/**/*.test.ts"],
	},
	mixer: { globs: ["src/mixer/**"] },
})};\n`;

describe("systems", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("prints every system the config names", async () => {
		await deps.commit(deps.root, "arbor.systems.ts", SYSTEMS, "name systems");

		await systems(deps);

		const out = color.strip(deps.out());
		expect(out).toContain(
			"playback (player)\n  Playing a song\n  globs   src/audio/**",
		);
		expect(out).toContain("  ignore  src/audio/**/*.test.ts");
		expect(out).toContain("mixer\n  globs   src/mixer/**");
	});

	it("prints one by an alias", async () => {
		await deps.commit(deps.root, "arbor.systems.ts", SYSTEMS, "name systems");

		await systems(deps, { name: "player", json: true });

		expect(JSON.parse(deps.out())).toEqual([
			{
				name: "playback",
				description: "Playing a song",
				aliases: ["player"],
				globs: ["src/audio/**"],
				ignore: ["src/audio/**/*.test.ts"],
			},
		]);
	});

	it("refuses a name no system answers to", async () => {
		const failure = await systems(deps, { name: "mixer" }).catch(
			(entry: unknown) => entry,
		);

		expect(failure).toBeInstanceOf(Exit);
		expect((failure as Exit).reason).toBe("not_found");
	});

	it("says none are named yet when the config names none", async () => {
		await systems(deps);

		expect(deps.out()).toContain("no systems named yet");
	});

	it("prints the systems a task touches, from a config it named itself", async () => {
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.fs.mkdir(`${worktree}/src/audio`, { recursive: true });
		await deps.commit(worktree, "src/audio/play.ts", "x\n", "play");
		await deps.fs.write(`${worktree}/src/audio/play.test.ts`, "x\n");
		// Named in the task, uncommitted, and not on trunk.
		await deps.fs.write(`${worktree}/arbor.systems.ts`, SYSTEMS);
		deps.log.clear();

		await systems(deps, { task: "alpha", json: true });

		expect(
			JSON.parse(deps.out()).map((system: { name: string }) => system.name),
		).toEqual(["playback"]);
	});

	it("reads the worktree it runs in when given no task", async () => {
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.fs.write(`${worktree}/arbor.systems.ts`, SYSTEMS);
		deps.log.clear();

		await systems(deps, { name: "mixer", here: "alpha" });

		expect(color.strip(deps.out())).toContain("mixer");
	});

	it("says so when a task touches no system", async () => {
		await deps.commit(deps.root, "arbor.systems.ts", SYSTEMS, "name systems");
		await add(deps, "alpha");
		deps.log.clear();

		await systems(deps, { task: "alpha" });

		expect(deps.out()).toContain("alpha touches no named system");
	});

	it("refuses a task that is not there", async () => {
		const failure = await systems(deps, { task: "nobody" }).catch(
			(entry: unknown) => entry,
		);

		expect((failure as Exit).reason).toBe("not_found");
	});
});
