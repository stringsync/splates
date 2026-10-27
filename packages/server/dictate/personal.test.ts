import { beforeEach, describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { PersonalWords, parseWords } from "./personal";

const PATH = "/home/.splates/dictation.json";

describe("PersonalWords", () => {
	let fs: FakeFs;
	let store: PersonalWords;

	beforeEach(() => {
		fs = new FakeFs();
		store = new PersonalWords(PATH, { fs });
	});

	it("has no words and none saved when there is no file", async () => {
		expect(await store.words()).toEqual([]);
		expect(await store.saved()).toBe(false);
	});

	it("reads back what it saved", async () => {
		await store.save(["Pulumi", "Fly"]);
		expect(await store.words()).toEqual(["Pulumi", "Fly"]);
		expect(await store.saved()).toBe(true);
	});

	it("refuses a file without a list of strings", async () => {
		await fs.write(PATH, `{"words": [1]}`);
		await expect(store.words()).rejects.toThrow("no `words` list");
		await fs.write(PATH, "not json");
		await expect(store.words()).rejects.toThrow("is not JSON");
	});

	it("forgets them on remove", async () => {
		await store.save(["Pulumi"]);
		await store.remove();
		expect(await store.saved()).toBe(false);
	});

	it("parses a typed list on commas and lines, dropping blanks", () => {
		expect(parseWords(" Pulumi, Fly\n\nwebappwiz ,")).toEqual([
			"Pulumi",
			"Fly",
			"webappwiz",
		]);
	});
});
