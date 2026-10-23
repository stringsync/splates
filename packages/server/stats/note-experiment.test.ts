import { describe, expect, it } from "bun:test";
import type { Event } from "../records";
import { NoteExperiment } from "./note-experiment";
import { noteStats } from "./notes";
import type { Outcome } from "./outcomes";

const AT = "2026-10-23T00:00:00.000Z";
const LATER = "2026-10-24T00:00:00.000Z";
const NOW = Date.parse("2026-10-31T00:00:00.000Z");

describe("NoteExperiment", () => {
	it("separates phases and excludes baseline corrections, old work and events beyond seven days", () => {
		const events = [
			assigned("a"),
			judgment("a", 0.9, { afterReply: false, at: AT }),
			judgment("a", 0.1),
			judgment("a", 0.9, { at: "2026-10-31T00:00:00.000Z" }),
			assigned("b", true),
			judgment("b", 0.9),
			event("b", { action: "note read", subagent: false }),
			event("b", { action: "note applied", probability: 0.9 }),
			judgment("legacy", 0.9, { version: undefined }),
		];
		const outcomes = [
			ended("a"),
			ended("a", { startedAt: "2026-10-22T00:00:00.000Z" }),
			ended("a", { endedAt: "2026-10-22T00:00:00.000Z" }),
			ended("legacy"),
		];
		const report = new NoteExperiment(
			[{ project: "/repo", events }],
			outcomes,
			NOW,
		).read();
		expect(report.pointed).toMatchObject({
			assigned: 1,
			mature: 1,
			corrected: 0,
			merged: 1,
			inProgress: 1,
			tasks: 1,
		});
		expect(report.holdout).toMatchObject({
			assigned: 1,
			corrected: 1,
			reads: 1,
			applied: 1,
		});
		expect(report.models[0]).toMatchObject({
			agent: "codex",
			model: "model-a",
			pointed: { merged: 1 },
			holdout: { merged: 0 },
		});
		expect(
			noteStats([{ project: "/repo", events }], outcomes, []).pointed
				.conversations,
		).toBe(1);
	});

	it("keeps failed routing and unfinished conversations in the denominator and widens uncertainty for missing labels", () => {
		const events = [
			assigned("a"),
			assigned("b", true),
			judgment("b", 0.1),
			event("a", {
				action: "notes routing failed",
				version: "notes-v2",
				failure: "judge failed",
			}),
		];
		const report = new NoteExperiment(
			[{ project: "/repo", events }],
			[],
			NOW,
		).read();
		expect(report.pointed).toMatchObject({
			assigned: 1,
			mature: 1,
			missing: 1,
			failures: 1,
			merged: 0,
		});
		expect(report.difference?.[1]).toBe(1);
		expect(report.decision).toBe("collecting");
		const early = new NoteExperiment(
			[{ project: "/repo", events }],
			[],
			Date.parse(LATER),
		).read();
		expect(early.pointed).toMatchObject({ mature: 0, pending: 1 });
		expect(early.difference).toBeNull();
	});

	it("waits for the fixed cohort and does not change its primary result when later conversations arrive", () => {
		const events = cohort(false, 0.1).concat(cohort(true, 0.1));
		const sources = [{ project: "/repo", events }];
		const report = new NoteExperiment(sources, [], NOW).read();
		expect(report.decision).toBe("not worthwhile");
		const later = [assigned("later"), judgment("later", 0.9)];
		const expanded = new NoteExperiment(
			[{ project: "/repo", events: [...events, ...later] }],
			[],
			NOW,
		).read();
		expect(expanded.pointed).toMatchObject({
			assigned: 401,
			mature: 400,
			corrected: 0,
		});
		expect(expanded.difference).toEqual(report.difference);
	});

	it("can distinguish a large benefit from an inconclusive result", () => {
		const benefit = new NoteExperiment(
			[
				{
					project: "/repo",
					events: cohort(false, 0.1).concat(cohort(true, 0.9)),
				},
			],
			[],
			NOW,
		).read();
		expect(benefit.decision).toBe("worthwhile");
		const close = new NoteExperiment(
			[
				{
					project: "/repo",
					events: cohort(false, 0.9, 160).concat(cohort(true, 0.9, 180)),
				},
			],
			[],
			NOW,
		).read();
		expect(close.decision).toBe("inconclusive");
	});

	it("does not combine coincident conversation ids across projects", () => {
		const report = new NoteExperiment(
			[
				{ project: "/repo", events: [assigned("a"), judgment("a", 0.1)] },
				{
					project: "/other",
					events: [assigned("a", true), judgment("a", 0.9)],
				},
			],
			[ended("a")],
			NOW,
		).read();
		expect(report.pointed.merged).toBe(1);
		expect(report.holdout.merged).toBe(0);
	});
});

function cohort(
	holdout: boolean,
	probability: number,
	corrected = 400,
): Event[] {
	return Array.from({ length: 400 }, (_, index) => {
		const id = `${holdout}-${index}`;
		return [
			assigned(id, holdout),
			judgment(id, index < corrected ? probability : 0.1),
		];
	}).flat();
}

function assigned(conversation: string, holdout = false): Event {
	return event(conversation, {
		action: "notes assigned",
		version: "notes-v2",
		assignedAt: AT,
		holdout,
		at: AT,
	});
}

function judgment(
	conversation: string,
	corrects: number,
	more: object = {},
): Event {
	return event(conversation, {
		action: "notes attached",
		version: "notes-v2",
		holdout: false,
		notes: [],
		ms: 5,
		afterReply: true,
		corrects,
		...more,
	});
}

function event(conversation: string, facts: object): Event {
	return {
		id: "event",
		conversation,
		at: LATER,
		task: null,
		reason: null,
		...facts,
	} as Event;
}

function ended(conversation: string, more: Partial<Outcome> = {}): Outcome {
	return {
		project: "/repo",
		task: "work",
		base: "main",
		conversation,
		agent: "codex",
		model: "model-a",
		ended: "merged",
		startedAt: LATER,
		endedAt: LATER,
		questionRounds: 0,
		reviewRounds: 0,
		failedMerges: 0,
		...more,
	};
}
