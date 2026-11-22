import { beforeEach, describe, expect, it } from "bun:test";
import { FakeFs } from "core/system/testing";
import { DEFAULT_RULES } from "./defaults";
import type { AutoPickRules } from "./rules";
import { AutoPickStore } from "./store";

const PATH = "/home/.splates/auto-pick.json";

const MINE: AutoPickRules = {
	...DEFAULT_RULES,
	threshold: 0.7,
	lineups: DEFAULT_RULES.lineups.map((each) =>
		each.id === "quick" ? { ...each, picks: [{ agent: "codex" }] } : each,
	),
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

	it("refuses to save a cell sent to no lineup, leaving the file alone", async () => {
		expect(
			store.save({
				...MINE,
				routes: {
					...MINE.routes,
					devops: { ...MINE.routes.devops, deep: "gone" },
				},
			}),
		).rejects.toThrow("no lineup has the id 'gone'");
		expect(await fs.exists(PATH)).toBe(false);
	});

	it("names the file when it is not JSON", async () => {
		await fs.mkdir("/home/.splates", { recursive: true });
		await fs.write(PATH, "{");
		expect(store.rules()).rejects.toThrow(`${PATH} is not JSON`);
	});

	it("names the file and the problem when it holds no rules", async () => {
		await fs.mkdir("/home/.splates", { recursive: true });
		await fs.write(
			PATH,
			JSON.stringify({ format: 3, threshold: 0.5, lineups: [], routes: {} }),
		);
		expect(store.rules()).rejects.toThrow(
			`${PATH} is not Auto pick rules: lineups: the rules list at least one lineup`,
		);
	});

	it("puts the defaults back on reset", async () => {
		await store.save(MINE);
		expect(await store.reset()).toEqual(DEFAULT_RULES);
		expect(await store.rules()).toEqual(DEFAULT_RULES);
	});
});
