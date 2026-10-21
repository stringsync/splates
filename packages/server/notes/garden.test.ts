import { describe, expect, it } from "bun:test";
import { GARDEN_TASK, unclaimed } from "./index";

describe("unclaimed", () => {
	const notes = [
		{ path: "/repo/notes/exports.md", description: "Why exports" },
		{ path: "/repo/notes/money.md", description: "What the client agreed" },
	];

	it("leaves out a note a queued task names by its path", () => {
		expect(
			unclaimed(
				notes,
				"/repo",
				[{ subject: "Stale note", text: "`notes/money.md` no longer holds" }],
				[],
			),
		).toEqual(["notes/exports.md"]);
	});

	it("reads every note, by its path from the root, while no task names one", () => {
		expect(
			unclaimed(notes, "/repo", [{ subject: "exports", text: "" }], ["other"]),
		).toEqual(["notes/exports.md", "notes/money.md"]);
	});

	it("reads none while the gardener's last fixes wait for review", () => {
		expect(unclaimed(notes, "/repo", [], [GARDEN_TASK])).toEqual([]);
	});
});
