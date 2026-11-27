import { describe, expect, it } from "bun:test";
import { FakeFs } from "core/system/testing";
import { FsStorage } from "../storage";
import { overlap, repeatedCorrections, ruleTaskText, tokens } from "./repeats";
import { TrustStore } from "./store";
import {
	pendingRuleSuggestions,
	RULE_SUGGESTIONS_DOC,
	RuleSuggestions,
	type SuggestedFile,
	type SuggestionBoard,
} from "./suggestions";
import type { TrustDecision } from "./types";

describe("repeatedCorrections", () => {
	it("groups three alike overturns and keeps the first one's id as its key", () => {
		const decision = decisions();
		const first = decision();
		const found = repeatedCorrections([
			first,
			decision({ subject: "Which retry limit should uploads use?" }),
			decision({ subject: "What retry limit for the upload worker?" }),
		]);
		expect(found).toHaveLength(1);
		expect(found[0]?.key).toBe(first.id);
		expect(found[0]?.decisions).toHaveLength(3);
	});

	it("leaves out kept picks, other kinds, other projects, plans and unlike answers", () => {
		const decision = decisions();
		const found = repeatedCorrections([
			decision(),
			decision(),
			decision({ outcome: "kept" }),
			decision({ kind: "scope" }),
			decision({ project: "/other" }),
			decision({ source: "plan" }),
			decision({ instead: "No retries, fail fast" }),
		]);
		expect(found).toEqual([]);
	});

	it("matches a decision with no recorded answer on its question alone", () => {
		const decision = decisions();
		const { instead: _, ...unknown } = decision({ source: "unasked" });
		expect(repeatedCorrections([decision(), decision(), unknown])).toHaveLength(
			1,
		);
	});

	it("waits for the threshold", () => {
		const decision = decisions();
		expect(repeatedCorrections([decision(), decision()])).toEqual([]);
		expect(
			repeatedCorrections([decision(), decision()], { threshold: 2 }),
		).toHaveLength(1);
	});
});

describe("tokens and overlap", () => {
	it("drops common words and folds plurals", () => {
		expect([...tokens("What should the retries be?")]).toEqual(["retrie"]);
		expect(overlap(tokens("upload retries"), tokens("retries upload"))).toBe(1);
	});
});

describe("ruleTaskText", () => {
	it("lists each correction and asks for a plan card before writing", () => {
		const decision = decisions();
		const repeat = repeatedCorrections([decision(), decision(), decision()])[0];
		const { subject, text } = ruleTaskText(repeat as never);
		expect(subject).toBe(
			"Write down a rule for: What retry limit should the upload worker use?",
		);
		expect(text).toContain(
			'the agent picked "3 retries"; the user chose "5 retries"',
		);
		expect(text).toContain("3 times");
		expect(text).toContain("plan card");
		expect(text).toContain("--reason nothing");
	});
});

describe("RuleSuggestions", () => {
	it("adds one Backlog task per repeat and never suggests it again", async () => {
		const decision = decisions();
		const storage = new FsStorage("/home/.splates", new FakeFs());
		const trust = new TrustStore(storage);
		const added: { subject: string; from: string | null }[] = [];
		const board: SuggestionBoard = {
			add: async (subject, from) => {
				added.push({ subject, from });
				return { id: added.length };
			},
		};
		const doc = storage.document<SuggestedFile>(RULE_SUGGESTIONS_DOC);
		const rules = new RuleSuggestions(trust, board, doc);
		await trust.recordMany([decision(), decision()]);
		expect(await rules.suggest("/repo", "t")).toEqual([]);
		await trust.record(decision());
		expect(await rules.suggest("/repo", "t")).toEqual([1]);
		expect(added[0]?.from).toBe("t");
		expect((await doc.read())?.tasks).toEqual({ d1: 1 });
		await trust.record(decision());
		expect(await rules.suggest("/repo", "t")).toEqual([]);
		expect(await rules.suggest("/other", "t")).toEqual([]);
		expect(added).toHaveLength(1);
	});
});

describe("pendingRuleSuggestions", () => {
	it("pairs available Backlog rule tasks with their corrections and skips queued, taken, or unrelated tasks", () => {
		const decision = decisions();
		const list = [decision(), decision(), decision()];
		const { subject } = ruleTaskText(repeatedCorrections(list)[0] as never);
		const views = pendingRuleSuggestions({
			project: "/repo",
			slug: "repo",
			decisions: list,
			recorded: { keys: ["d1"], tasks: { d1: 12 } },
			tasks: [
				{
					id: 12,
					subject: "Custom edited rule task",
					createdAt: "2026-11-25T10:00:00.000Z",
					stage: "available",
					takenBy: null,
				},
				{
					id: 13,
					subject,
					createdAt: "2026-11-25T11:00:00.000Z",
					stage: "queued",
					takenBy: null,
				},
				{
					id: 14,
					subject,
					createdAt: "2026-11-25T12:00:00.000Z",
					stage: "available",
					takenBy: "working-slug",
				},
				{
					id: 15,
					subject: "Ordinary backlog task",
					createdAt: "2026-11-25T13:00:00.000Z",
					stage: "available",
					takenBy: null,
				},
			],
		});
		expect(views).toHaveLength(1);
		expect(views[0]?.taskId).toBe(12);
		expect(views[0]?.slug).toBe("repo");
		expect(views[0]?.corrections).toHaveLength(3);
		expect(views[0]?.corrections[0]?.picked).toBe("3 retries");
		expect(views[0]?.corrections[0]?.instead).toBe("5 retries");
	});

	it("matches legacy rule tasks created before task ids were stored", () => {
		const decision = decisions();
		const list = [decision(), decision(), decision()];
		const { subject } = ruleTaskText(repeatedCorrections(list)[0] as never);
		const views = pendingRuleSuggestions({
			project: "/repo",
			slug: "repo",
			decisions: list,
			recorded: { keys: ["d1"] },
			tasks: [
				{
					id: 7,
					subject,
					createdAt: "2026-11-25T09:00:00.000Z",
					stage: "available",
					takenBy: null,
				},
			],
		});
		expect(views).toHaveLength(1);
		expect(views[0]?.taskId).toBe(7);
		expect(views[0]?.corrections).toHaveLength(3);
	});
});

/** A maker of decisions, each a day after the last, for one test. */
function decisions(): (over?: Partial<TrustDecision>) => TrustDecision {
	let made = 0;
	return (over = {}) => {
		made += 1;
		return {
			id: `d${made}`,
			at: `2026-11-${String(10 + made).padStart(2, "0")}T00:00:00.000Z`,
			project: "/repo",
			agent: "claude",
			model: "Opus 5.5",
			kind: "defaults",
			source: "question",
			outcome: "overturned",
			subject: "What retry limit should the upload worker use?",
			picked: "3 retries",
			instead: "5 retries",
			conversation: `c${made}`,
			task: null,
			...over,
		};
	};
}
