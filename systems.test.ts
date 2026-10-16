import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFs } from "webappwiz/system";
import { mentionLine, Systems, unknownLine } from "./systems";

const PLAYBACK = {
	description: "Playing a song",
	aliases: ["player", "audio engine"],
	globs: ["packages/player/**", "src/audio/**"],
	ignore: ["packages/player/**/*.test.ts"],
};

describe("Systems", () => {
	const systems = Systems.of({
		playback: PLAYBACK,
		mixer: { globs: ["src/mixer/**"] },
	});
	const names = (text: string) =>
		systems.mentioned(text).map((system) => system.name);
	const fs = new NodeFs();
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "arbor-systems-"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
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

	it("mentioned finds each system a # names, by name or alias, once, in order", () => {
		expect(names("Fix #mixer, then #player and #playback.")).toEqual([
			"mixer",
			"playback",
		]);
	});

	it("mentioned leaves alone a # that names no system, or sits inside a word", () => {
		expect(names("[ARBOR TODO #12] see issue#mixer and #nothing")).toEqual([]);
	});

	it("unknown finds each # that names no system, once, in order", () => {
		const only = Systems.of({ playback: PLAYBACK });

		expect(
			only.unknown("Fix #mixer and #player, then #queue and #mixer."),
		).toEqual(["mixer", "queue"]);
	});

	it("unknown leaves alone a todo's number, a # inside a word, and code", () => {
		const only = Systems.of({ playback: PLAYBACK });

		expect(
			only.unknown(
				"[ARBOR TODO #12] see #3, issue#mixer, `#fff` and\n```\n#queue\n```",
			),
		).toEqual([]);
	});

	it("unknown reads a range of todo numbers, such as #197-#201, as todos", () => {
		const only = Systems.of({ playback: PLAYBACK });

		expect(only.unknown("Blocked by #197-#201, then #12-")).toEqual([]);
	});

	it("unknownLine asks the agent to find the code and offer a name", () => {
		expect(unknownLine("mixer")).toStartWith("#mixer names no system: ");
	});

	it("tells an agent a mentioned system's aliases, description, globs, and ignores", () => {
		expect(mentionLine({ name: "playback", ...PLAYBACK })).toBe(
			"#playback (player, audio engine): Playing a song. Made of packages/player/**, src/audio/**; not packages/player/**/*.test.ts",
		);
	});

	it("mentionLine leaves out what the system does not have", () => {
		expect(mentionLine({ name: "mixer", globs: ["src/mixer/**"] })).toBe(
			"#mixer: src/mixer/**",
		);
	});

	it("Systems.at names none when there is no systems file", async () => {
		expect((await Systems.at(root, { fs })).all()).toEqual([]);

		await fs.write(join(root, "arbor.config.ts"), "export default {};\n");

		expect((await Systems.at(root, { fs })).all()).toEqual([]);
	});

	it("Systems.at reads the systems file afresh, as a long-running dev needs", async () => {
		await named({ mixer: { globs: ["src/mixer/**"] } });
		expect((await Systems.at(root, { fs })).find("mixer")).not.toBeNull();

		await named({ playback: PLAYBACK });
		const now = await Systems.at(root, { fs });

		expect(now.find("mixer")).toBeNull();
		expect(now.find("player")?.name).toBe("playback");
		expect(now.all().map((each) => each.name)).toEqual(["playback"]);
	});

	it("Systems.at reads a systems file made after arbor read the config beside it", async () => {
		// On macOS the temporary directory is reached through a symlink, which
		// is where Bun's resolver missed a file made after it listed the
		// directory.
		await fs.write(join(root, "arbor.config.ts"), "export default {};\n");
		expect((await Systems.at(root, { fs })).all()).toEqual([]);

		await named({ mixer: { globs: ["src/mixer/**"] } });

		expect((await Systems.at(root, { fs })).find("mixer")).not.toBeNull();
	});

	it("Systems.at refuses a system not in the shape a system takes", async () => {
		await named({ playback: { globs: "src/audio/**" } });

		expect(await failure()).toContain("playback.globs");
	});

	it("refuses a system with more than two aliases", async () => {
		await named({
			playback: { globs: ["a/**"], aliases: ["player", "audio", "sound"] },
		});

		expect(await failure()).toContain("playback.aliases");
	});

	it("refuses a description longer than one short line", async () => {
		await named({
			playback: { globs: ["a/**"], description: "x".repeat(81) },
		});
		expect(await failure()).toContain("playback.description");

		await named({
			playback: { globs: ["a/**"], description: "Playing\na song" },
		});
		expect(await failure()).toContain("must be one line");
	});

	it("Systems.at refuses two systems that answer to the same name", async () => {
		await named({
			playback: { globs: ["a/**"], aliases: ["mixer"] },
			mixer: { globs: ["b/**"] },
		});

		expect(await failure()).toContain(
			"'playback' and 'mixer' both answer to 'mixer'",
		);
	});

	it("Systems.at refuses a systems file that will not load, naming it", async () => {
		await fs.write(
			join(root, "arbor.systems.ts"),
			`import "./nowhere";\nexport default {};\n`,
		);

		expect(await failure()).toContain("arbor.systems.ts");
	});

	it("refuses systems still in arbor.config.ts, saying to run `arbor update`", async () => {
		await fs.write(
			join(root, "arbor.config.ts"),
			`export default { systems: { docs: { globs: ["*.md"] } } };\n`,
		);

		expect(await failure()).toContain("arbor update");
	});

	const named = (systems: unknown) =>
		fs.write(
			join(root, "arbor.systems.ts"),
			`export default ${JSON.stringify(systems)};\n`,
		);
	const failure = () =>
		Systems.at(root, { fs }).then(
			() => "",
			(error: Error) => error.message,
		);
});
