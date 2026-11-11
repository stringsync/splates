import { describe, expect, it } from "bun:test";
import { latestPerClass } from "./model-classes";

const list = (...names: string[]) =>
	names.map((name) => ({ value: name.toLowerCase(), name }));

describe("latestPerClass", () => {
	it("keeps the newest of each class, in the list's order", () => {
		const options = list(
			"Opus 4.1",
			"Sonnet 4.5",
			"Opus 5.5",
			"Sonnet 5.5",
			"Haiku 5.5",
		);
		expect(latestPerClass("", options).map((each) => each.name)).toEqual([
			"Opus 5.5",
			"Sonnet 5.5",
			"Haiku 5.5",
		]);
	});
	it("compares versions as numbers", () => {
		const options = list("GPT-5.9 Sol", "GPT-5.10 Sol", "GPT-5 Luna");
		expect(latestPerClass("", options).map((each) => each.name)).toEqual([
			"GPT-5.10 Sol",
			"GPT-5 Luna",
		]);
	});
	it("keeps the model in use even when older", () => {
		const options = list("Opus 4.1", "Opus 5.5");
		expect(
			latestPerClass("opus 4.1", options).map((each) => each.name),
		).toEqual(["Opus 4.1", "Opus 5.5"]);
	});
	it("keeps providers apart", () => {
		const options = [
			{ value: "a/x", name: "Shared" },
			{ value: "b/x", name: "Shared" },
		];
		expect(latestPerClass("", options)).toEqual(options);
	});
});
