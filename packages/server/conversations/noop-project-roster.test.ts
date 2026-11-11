import { describe, expect, test } from "bun:test";
import { NoopProjectRoster } from "./noop-project-roster";

describe("NoopProjectRoster", () => {
	test("lists no projects", async () => {
		const roster = new NoopProjectRoster();

		expect(await roster.list()).toEqual([]);
	});

	test("reaches as far as a default grant", async () => {
		const roster = new NoopProjectRoster();

		expect(await roster.reach("/a", "/b")).toBe("queue");
	});
});
