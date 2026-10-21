import { describe, expect, it } from "bun:test";
import { MemoryStorage } from "../storage/testing";
import { NoteUses } from "./uses";

describe("NoteUses", () => {
	it("counts each conversation that read a note once", async () => {
		const uses = new NoteUses(new MemoryStorage());
		await uses.add("one", "notes/a.md");
		await uses.add("one", "notes/a.md");
		await uses.add("two", "notes/a.md");
		await uses.add("two", "notes/b.md");
		expect(await uses.counts()).toEqual(
			new Map([
				["notes/a.md", 2],
				["notes/b.md", 1],
			]),
		);
	});

	it("keeps the counts of lines written at the end of each turn", async () => {
		const storage = new MemoryStorage();
		const log = storage.log<{ conversation: string; notes: string[] }>(
			"note-uses.jsonl",
		);
		await log.append({ conversation: "one", notes: ["notes/a.md"] });
		await log.append({
			conversation: "one",
			notes: ["notes/a.md", "notes/b.md"],
		});
		const uses = new NoteUses(storage);
		await uses.add("one", "notes/b.md");
		expect(await uses.counts()).toEqual(
			new Map([
				["notes/a.md", 1],
				["notes/b.md", 1],
			]),
		);
	});
});
