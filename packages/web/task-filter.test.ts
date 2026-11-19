import { describe, expect, it } from "bun:test";
import { projectOptions, TaskFilter } from "./task-filter";

const item = (project: string | null) => ({ project });

describe("task filter", () => {
	it("lets everything through until something is picked", () => {
		expect(new TaskFilter().passes(item(null))).toBe(true);
	});

	it("several projects mean any of them", () => {
		const filter = new TaskFilter();
		filter.toggleProject("mdom");
		filter.toggleProject("vexml");
		expect(filter.passes(item("vexml"))).toBe(true);
		expect(filter.passes(item("core"))).toBe(false);
		expect(filter.passes(item(null))).toBe(false);
	});

	it("keeps the choice for the next visit", () => {
		const data = new Map<string, string>();
		const storage = {
			getItem: (key: string) => data.get(key) ?? null,
			setItem: (key: string, value: string) => void data.set(key, value),
		} as Storage;
		new TaskFilter(storage).toggleProject("mdom");
		expect(new TaskFilter(storage).projects).toEqual(["mdom"]);
	});

	it("offers the projects in use, plus any picked", () => {
		expect(projectOptions([item("b"), item("a")], ["old"])).toEqual([
			"a",
			"b",
			"old",
		]);
	});
});
