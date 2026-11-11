import { describe, expect, test } from "bun:test";
import { NoopJournal } from "./noop-journal";

const addFacts = {
	base: "main",
	tasks: [],
	goal: null,
	subjects: [],
	agent: null,
	model: null,
};

describe("NoopJournal", () => {
	test("runs what it records and returns its result", async () => {
		const journal = new NoopJournal();

		const out = await journal.record("add", null, async () => 7, addFacts);

		expect(out).toBe(7);
	});

	test("remembers no events", async () => {
		const journal = new NoopJournal();
		await journal.record("add", null, async () => 7, addFacts);

		expect(await journal.all()).toEqual([]);
		expect(await journal.tail(5)).toEqual([]);
		expect(await journal.recent()).toEqual([]);
	});
});
