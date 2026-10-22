import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Testing } from "../testing";
import { exportBundle, importBundle, parseBundle } from "./index";

describe("config transfer", () => {
	let from: Testing;
	let to: Testing;

	beforeEach(async () => {
		from = await Testing.open();
		to = await Testing.open();
	});

	afterEach(async () => {
		await from.disposeAsync();
		await to.disposeAsync();
	});

	const places = (side: Testing) => ({
		fs: side.fs,
		splatesDir: side.splatesDir,
		home: side.splatesHome,
	});

	it("carries config, tasks and plans, never creds", async () => {
		await from.fs.mkdir(`${from.splatesDir}/plans`, { recursive: true });
		await from.fs.write(`${from.splatesDir}/plans/a.md`, "plan");
		await from.fs.write(`${from.splatesDir}/hooks.json`, "{}");
		await from.fs.write(`${from.splatesDir}/creds.json`, "secret");
		await from.fs.mkdir(from.splatesHome, { recursive: true });
		await from.fs.write(`${from.splatesHome}/agents.json`, "{}");
		await from.fs.write(`${from.splatesHome}/offered.json`, "{}");
		await from.fs.write(`${from.splatesHome}/spend.jsonl`, "");

		const bundle = await exportBundle(places(from));
		expect(Object.keys(bundle.project).sort()).toEqual([
			"hooks.json",
			"plans/a.md",
		]);
		expect(Object.keys(bundle.machine)).toEqual([
			"agents.json",
			"offered.json",
		]);
		expect(JSON.stringify(bundle)).not.toContain("secret");

		const done = await importBundle(places(to), bundle, { force: false });
		expect(done.written).toHaveLength(4);
		expect(await to.fs.read(`${to.splatesDir}/plans/a.md`)).toBe("plan");
	});

	it("stops on a differing file unless forced", async () => {
		await from.fs.write(`${from.splatesDir}/hooks.json`, "new");
		await to.fs.write(`${to.splatesDir}/hooks.json`, "old");
		const bundle = await exportBundle(places(from));
		await expect(
			importBundle(places(to), bundle, { force: false }),
		).rejects.toThrow("differ");
		expect(await to.fs.read(`${to.splatesDir}/hooks.json`)).toBe("old");
		await importBundle(places(to), bundle, { force: true });
		expect(await to.fs.read(`${to.splatesDir}/hooks.json`)).toBe("new");
	});

	it("refuses a bundle that reaches outside or names creds", () => {
		const bundle = (project: Record<string, string>) =>
			JSON.stringify({
				format: "splates-config",
				version: 1,
				project,
				machine: {},
			});
		expect(() => parseBundle(bundle({ "../x": "" }), "f")).toThrow();
		expect(() => parseBundle(bundle({ "creds.json": "" }), "f")).toThrow();
		expect(() => parseBundle("{}", "f")).toThrow();
	});
});
