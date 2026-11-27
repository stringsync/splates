import { expect, test } from "bun:test";
import { stretches } from "./asked";

test("adjacent Queued headings group into one card with their Why lines", () => {
	const found = stretches(
		"Queued two.\n\n## 🤖 Queued #821: Fix the flaky test\n\nWhy: failed twice; one file.\n\n## 🤖 Queued #822: Note the setting\n\nWhy: docs only.",
	);
	expect(found).toEqual([
		{ type: "text", text: "Queued two." },
		{
			type: "queued",
			queued: {
				tasks: [
					{
						id: 821,
						subject: "Fix the flaky test",
						why: "failed twice; one file.",
					},
					{ id: 822, subject: "Note the setting", why: "docs only." },
				],
			},
		},
	]);
});

test("a sprout heading from an older skill still groups into the card", () => {
	const found = stretches(
		"## 🌱 Queued #821: Fix the flaky test\n\nWhy: failed twice.",
	);
	expect(found).toEqual([
		{
			type: "queued",
			queued: {
				tasks: [
					{ id: 821, subject: "Fix the flaky test", why: "failed twice." },
				],
			},
		},
	]);
});

test("Queued lane headings parse as a lane card and stay separate from adjacent queued tasks", () => {
	const found = stretches(
		"## 🤖 Queued lane 349: Testing and engraving rework\n\nWhy: approved four-task split.\n\n## 🤖 Queued #821: Fix the flaky test\n\nWhy: failed twice.",
	);
	expect(found).toEqual([
		{
			type: "queued",
			queued: {
				tasks: [],
				lane: {
					id: 349,
					name: "Testing and engraving rework",
					why: "approved four-task split.",
				},
			},
		},
		{
			type: "queued",
			queued: {
				tasks: [
					{ id: 821, subject: "Fix the flaky test", why: "failed twice." },
				],
			},
		},
	]);
});
