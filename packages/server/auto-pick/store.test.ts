import { beforeEach, describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { DEFAULT_RULES } from "./defaults";
import type { AutoPickRules } from "./rules";
import { AutoPickStore } from "./store";

const PATH = "/home/.splates/auto-pick.json";

const MINE: AutoPickRules = {
	format: 2,
	threshold: 0.7,
	rules: [
		{ kind: "bugfix", depth: "*", picks: [{ agent: "codex" }] },
		{ kind: "*", depth: "*", picks: [{ agent: "claude", model: "opus" }] },
	],
};

describe("AutoPickStore", () => {
	let fs: FakeFs;
	let store: AutoPickStore;

	beforeEach(() => {
		fs = new FakeFs();
		store = new AutoPickStore(PATH, { fs });
	});

	it("reads the defaults when there is no file", async () => {
		expect(await store.rules()).toEqual(DEFAULT_RULES);
	});

	it("keeps saved rules as pretty JSON and reads them back", async () => {
		await store.save(MINE);
		expect(await fs.read(PATH)).toBe(`${JSON.stringify(MINE, null, "\t")}\n`);
		expect(await store.rules()).toEqual(MINE);
	});

	it("refuses to save rules that do not end on * *, leaving the file alone", async () => {
		await expect(
			store.save({ ...MINE, rules: MINE.rules.slice(0, 1) }),
		).rejects.toThrow("the last rule must be kind * and depth *");
		expect(await fs.exists(PATH)).toBe(false);
	});

	it("names the file when it is not JSON", async () => {
		await fs.mkdir("/home/.splates", { recursive: true });
		await fs.write(PATH, "{");
		await expect(store.rules()).rejects.toThrow(`${PATH} is not JSON`);
	});

	it("names the file and the problem when it holds no rules", async () => {
		await fs.mkdir("/home/.splates", { recursive: true });
		await fs.write(
			PATH,
			JSON.stringify({ format: 2, threshold: 0.5, rules: [] }),
		);
		await expect(store.rules()).rejects.toThrow(
			`${PATH} is not Auto pick rules: rules: the rules list at least one rule`,
		);
	});

	it("puts the defaults back on reset", async () => {
		await store.save(MINE);
		expect(await store.reset()).toEqual(DEFAULT_RULES);
		expect(await store.rules()).toEqual(DEFAULT_RULES);
	});
});
