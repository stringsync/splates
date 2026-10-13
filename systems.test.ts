import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFs } from "webappwiz/system";
import { Systems } from "./systems";

const PLAYBACK = {
	aliases: ["player", "audio engine"],
	globs: ["packages/player/**", "src/audio/**"],
	ignore: ["packages/player/**/*.test.ts"],
};

describe("Systems", () => {
	const systems = Systems.of({
		playback: PLAYBACK,
		mixer: { globs: ["src/mixer/**"] },
	});

	it("finds a system by its name or any alias", () => {
		expect(systems.find("playback")?.name).toBe("playback");
		expect(systems.find("audio engine")?.name).toBe("playback");
		expect(systems.find("mixer")?.globs).toEqual(["src/mixer/**"]);
		expect(systems.find("visualizer")).toBeNull();
	});

	it("names the systems paths fall in, in the config's order", () => {
		expect(
			systems
				.touchedBy(["src/mixer/bus.ts", "packages/player/queue.ts"])
				.map((system) => system.name),
		).toEqual(["playback", "mixer"]);
	});

	it("leaves out a system whose only matches it ignores", () => {
		expect(systems.touchedBy(["packages/player/queue.test.ts"])).toEqual([]);
		expect(systems.touchedBy(["README.md"])).toEqual([]);
	});
});

describe("Systems.at", () => {
	const fs = new NodeFs();
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "arbor-systems-"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("names none when there is no config, or it names no systems", async () => {
		expect((await Systems.at(root, { fs })).all()).toEqual([]);

		await fs.write(join(root, "arbor.config.ts"), "export default {};\n");

		expect((await Systems.at(root, { fs })).all()).toEqual([]);
	});

	it("reads the config afresh once it changes, as a long-running dev needs", async () => {
		const config = join(root, "arbor.config.ts");
		await fs.write(
			config,
			`export default { systems: { mixer: { globs: ["src/mixer/**"] } } };\n`,
		);
		expect((await Systems.at(root, { fs })).find("mixer")).not.toBeNull();

		await fs.write(
			config,
			`export default { systems: { playback: ${JSON.stringify(PLAYBACK)} } };\n`,
		);
		const now = await Systems.at(root, { fs });

		expect(now.find("mixer")).toBeNull();
		expect(now.find("player")?.name).toBe("playback");
	});
});
