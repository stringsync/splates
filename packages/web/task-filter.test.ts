import { describe, expect, it } from "bun:test";
import { projectOptions, TaskFilter, tagOptions } from "./task-filter";

const item = (project: string | null, ...tags: string[]) => ({ project, tags });

describe("task filter", () => {
	it("lets everything through until something is picked", () => {
		expect(new TaskFilter().passes(item(null))).toBe(true);
	});

	it("several tags mean any of them, and a project must match too", () => {
		const filter = new TaskFilter();
		filter.toggleTag("a");
		filter.toggleTag("b");
		expect(filter.passes(item(null, "b"))).toBe(true);
		expect(filter.passes(item(null, "c"))).toBe(false);
		filter.toggleProject("mdom");
		expect(filter.passes(item("vexml", "a"))).toBe(false);
		expect(filter.passes(item("mdom", "a"))).toBe(true);
	});

	it("keeps the choice for the next visit", () => {
		const data = new Map<string, string>();
		const storage = {
			getItem: (key: string) => data.get(key) ?? null,
			setItem: (key: string, value: string) => void data.set(key, value),
		} as Storage;
		new TaskFilter(storage).toggleTag("ui");
		expect(new TaskFilter(storage).tags).toEqual(["ui"]);
	});

	it("offer the allowed tags, else the tags in use, plus any picked", () => {
		const items = [item("a", "x"), item("b", "y")];
		expect(tagOptions(["z", "x"], items, [])).toEqual(["x", "z"]);
		expect(tagOptions(undefined, items, ["old"])).toEqual(["old", "x", "y"]);
		expect(projectOptions(items, [])).toEqual(["a", "b"]);
	});
});
