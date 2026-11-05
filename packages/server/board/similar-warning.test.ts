import { expect, test } from "bun:test";
import { similarTasks } from "./similar-warning";
import type { Task } from "./task";

const task = (id: number, subject: string) => ({ id, subject }) as Task;

test("the same fix worded alike is similar", () => {
	const open = [
		task(2056, "Scope gate reads After"),
		task(2061, "Scope gate reads the After section"),
		task(2067, "Make the scope gate read After"),
	];
	expect(
		similarTasks("Scope gate reads After", open).map((each) => each.id),
	).toEqual([2056, 2061, 2067]);
});

test("unrelated subjects are not similar", () => {
	const open = [task(1, "Scope gate reads After"), task(2, "Fix the web page")];
	expect(similarTasks("Add a merge queue card", open)).toEqual([]);
	expect(similarTasks("Scope the web page", open)).toEqual([]);
});
