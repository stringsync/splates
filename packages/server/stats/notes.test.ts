import { describe, expect, it } from "bun:test";
import type { Event } from "../records";
import type { Judged } from "./adherence";
import { noteStats } from "./notes";
import type { Outcome } from "./outcomes";

describe("noteStats", () => {
	it("does not credit work finished before the first routing judgment", () => {
		const stats = noteStats(
			from([attached("a", false, [])]),
			[
				ended({ conversation: "a", endedAt: "2026-10-13T00:00:00.000Z" }),
				ended({ conversation: "a" }),
			],
			[],
		);
		expect(stats.pointed.merged).toBe(1);
	});
	it("sets conversations with pointers against the holdout, and counts how each note was pointed at, read and applied", () => {
		const stats = noteStats(
			from([
				attached("a", false, [
					{ path: "notes/x.md", tier: "now" },
					{ path: "notes/y.md", tier: "optional" },
				]),
				read("a", "notes/x.md"),
				read("a", "notes/z.md"),
				applied("a", "notes/x.md", 0.9),
				applied("a", "notes/z.md", 0.2),
				attached("a", false, []),
				attached("b", true, []),
				// Not the first message, so it does not move the arm.
				attached("b", false, [{ path: "notes/x.md", tier: "now" }]),
			]),
			[
				ended({ conversation: "a", usage: usage(100) }),
				ended({ conversation: "a", failedMerges: 1, usage: usage(300) }),
				ended({ conversation: "b", ended: "removed", removedFor: "redo" }),
				ended({ conversation: "other" }),
			],
			[judged("a", 3, 1), judged("b", 1, 1)],
		);

		expect(stats.pointed).toMatchObject({
			conversations: 1,
			merged: 2,
			firstTry: 1,
			used: 2,
			tokens: 400,
			checksPassed: 3,
			checksApplied: 4,
		});
		expect(stats.holdout).toMatchObject({
			conversations: 1,
			merged: 0,
			removed: 1,
			redone: 1,
			checksApplied: 2,
		});
		expect([stats.messages, stats.attached]).toEqual([2, 1]);
		expect(stats.p50).toBe(10);
		expect(stats.notes).toEqual([
			{
				project: "/repo",
				path: "notes/x.md",
				now: 1,
				optional: 0,
				nowRead: 1,
				optionalRead: 0,
				unprompted: 0,
				judged: 1,
				applied: 1,
			},
			{
				project: "/repo",
				path: "notes/y.md",
				now: 0,
				optional: 1,
				nowRead: 0,
				optionalRead: 0,
				unprompted: 0,
				judged: 0,
				applied: 0,
			},
			{
				project: "/repo",
				path: "notes/z.md",
				now: 0,
				optional: 0,
				nowRead: 0,
				optionalRead: 0,
				unprompted: 1,
				judged: 1,
				applied: 0,
			},
		]);
	});

	it("reads corrections by arm, the judge's spend, the notes' share of context and turns per merged task", () => {
		const stats = noteStats(
			from([
				attached("a", false, [], { corrects: 0.9, dollars: 0.002 }),
				attached("a", false, [], { corrects: 0.1, dollars: 0.002 }),
				// From before corrections and spend were kept.
				attached("a", false, []),
				attached("b", true, [], { corrects: 0.7, dollars: null }),
				read("a", "notes/x.md", { bytes: 4000, context: 10_000 }),
				read("a", "notes/y.md", { bytes: 4000, context: 20_000 }),
				// A subagent's read is in its own context.
				read("a", "notes/z.md", {
					bytes: 8000,
					context: 30_000,
					subagent: true,
				}),
				applied("a", "notes/x.md", 0.9, { dollars: 0.001 }),
				applied("b", "notes/x.md", 0.9, { dollars: 0.001 }),
			]),
			[
				ended({ conversation: "a", turns: 3 }),
				ended({ conversation: "a", turns: 6 }),
				// From before turns were kept.
				ended({ conversation: "a" }),
			],
			[],
		);

		expect(stats.pointed).toMatchObject({
			said: 2,
			corrected: 1,
			turned: 2,
			turns: 9,
		});
		expect(stats.holdout).toMatchObject({ said: 1, corrected: 1 });
		expect(stats.spend).toEqual({
			routing: 0.004,
			routed: 2,
			weighing: 0.002,
			weighed: 2,
		});
		expect(stats.context).toEqual({
			conversations: 1,
			tokens: 2000,
			share: 0.1,
		});
	});

	it("reads the projects it is given, keeping their notes and outcomes apart", () => {
		const stats = noteStats(
			[
				{
					project: "/repo",
					events: [attached("a", false, [{ path: "notes/x.md", tier: "now" }])],
				},
				{
					project: "/other",
					events: [attached("b", false, [{ path: "notes/x.md", tier: "now" }])],
				},
			],
			[
				ended({ conversation: "a" }),
				ended({ conversation: "b", project: "/other" }),
				ended({ conversation: "c", project: "/elsewhere" }),
			],
			[],
		);

		expect(stats.projects).toEqual(["/repo", "/other"]);
		expect(stats.pointed).toMatchObject({ conversations: 2, merged: 2 });
		expect(stats.notes.map((each) => [each.project, each.now])).toEqual([
			["/other", 1],
			["/repo", 1],
		]);
	});

	it("shows nothing when the router judged no message", () => {
		const stats = noteStats([], [], []);

		expect(stats.pointed.conversations).toBe(0);
		expect(stats.p50).toBeNull();
		expect(stats.context.share).toBeNull();
		expect(stats.notes).toEqual([]);
	});
});

/** Events of one project, `/repo` unless named. */
function from(events: Event[], project = "/repo") {
	return [{ project, events }];
}

function event(conversation: string, facts: object): Event {
	return {
		id: "e",
		at: "2026-10-14T10:00:00.000Z",
		task: null,
		reason: null,
		conversation,
		...facts,
	} as Event;
}

function attached(
	conversation: string,
	holdout: boolean,
	notes: { path: string; tier: "now" | "optional" }[],
	more: object = {},
): Event {
	return event(conversation, {
		...more,
		action: "notes attached",
		holdout,
		ms: 10,
		notes: notes.map((each) => ({
			...each,
			probability: 0.9,
			inContext: false,
			updated: false,
		})),
	});
}

function read(conversation: string, path: string, more: object = {}): Event {
	return event(conversation, {
		action: "note read",
		path,
		hash: "h",
		tool: "t",
		subagent: false,
		...more,
	});
}

function applied(
	conversation: string,
	path: string,
	probability: number,
	more: object = {},
): Event {
	return event(conversation, {
		action: "note applied",
		path,
		probability,
		tier: "now",
		...more,
	});
}

function judged(conversation: string, passed: number, failed: number): Judged {
	return {
		conversation,
		project: "/repo",
		agent: "claude",
		skill: null,
		at: "2026-10-14T10:00:00.000Z",
		scores: { merge: { passed, failed } },
	};
}

function usage(input: number): Outcome["usage"] {
	return { input, cached: 0, output: 0, cost: null };
}

/** A merged task of `/repo`'s; a test overrides what it is about. */
function ended(changes: Partial<Outcome>): Outcome {
	return {
		project: "/repo",
		task: "beta",
		base: "main",
		ended: "merged",
		startedAt: "2026-10-10T09:00:00.000Z",
		endedAt: "2026-10-14T10:00:00.000Z",
		questionRounds: 0,
		reviewRounds: 0,
		failedMerges: 0,
		conversation: null,
		agent: null,
		model: null,
		...changes,
	};
}
