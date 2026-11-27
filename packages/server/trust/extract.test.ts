import { describe, expect, it } from "bun:test";
import { conversation, message } from "../fixtures";
import { extractConversationDecisions, parseRevertCommit } from "./extract";

const AT = "2026-11-25T20:00:00.000Z";

function stateWithModel(messages: ReturnType<typeof message>[]) {
	return conversation({
		id: "conv-1",
		agent: "claude",
		task: "trust-record",
		settings: [
			{
				id: "model",
				name: "Model",
				type: "select",
				category: "model",
				current: "opus-4-6",
				options: [{ value: "opus-4-6", name: "Opus 4.6", description: null }],
			},
		],
		messages,
	});
}

describe("extractConversationDecisions", () => {
	it("records kept, amended, and overturned question picks and mockup picks", () => {
		const state = stateWithModel([
			message(
				"agent",
				[
					"1. Should we keep the old endpoint?",
					"   - (a) Yes, keep it (chosen)",
					"   - (b) No, remove it",
					"2. Which card style looks better?",
					"   - (a) Rail (chosen)",
					"     ![rail](/abs/rail.png)",
					"   - (b) Panel",
					"     ![panel](/abs/panel.png)",
					"3. What retry limit should we use?",
					"   - (a) 3 retries (chosen)",
					"   - (b) 5 retries",
				].join("\n"),
			),
			message(
				"user",
				[
					"> **Should we keep the old endpoint?**",
					"",
					"- (a) Yes, keep it",
					"",
					"> **Which card style looks better?**",
					"",
					"- (b) Panel",
					"",
					"> **What retry limit should we use?**",
					"",
					"- (a) 3 retries",
					"",
					"Make sure it logs each retry.",
				].join("\n"),
			),
		]);

		const found = extractConversationDecisions(state, "/repo", AT);
		expect(found).toHaveLength(3);
		expect(found[0]).toMatchObject({
			project: "/repo",
			agent: "claude",
			model: "Opus 4.6",
			source: "question",
			outcome: "kept",
		});
		expect(found[0]?.instead).toBeUndefined();
		expect(found[1]).toMatchObject({
			source: "mockup",
			kind: "visual",
			outcome: "overturned",
			picked: "Rail",
			instead: "Panel",
		});
		expect(found[2]).toMatchObject({
			source: "question",
			kind: "defaults",
			outcome: "amended",
			picked: "3 retries",
		});
		expect(found[2]?.instead).toBeUndefined();
	});

	it("keeps the words of an overturn answered in words alone", () => {
		const state = stateWithModel([
			message(
				"agent",
				[
					"1. Which port should the dev server use?",
					"   - (a) 3000 (chosen)",
					"   - (b) 8080",
				].join("\n"),
			),
			message(
				"user",
				"> **Which port should the dev server use?**\n\nPick a free one at random.",
			),
		]);
		expect(extractConversationDecisions(state, "/repo", AT)[0]).toMatchObject({
			outcome: "overturned",
			picked: "3000",
			instead: "Pick a free one at random.",
		});
	});

	it("records plan approvals as kept when approved cleanly, amended with caveats, or overturned when sent back", () => {
		const approvedCleanly = stateWithModel([
			message(
				"agent",
				[
					"## 📝 Plan: add trust store",
					"",
					"**Goal:** Missing trust tracking.",
					"**After:** Tracks trust.",
					"",
					"1. Do you approve adding the trust store?",
					"   - (a) Yes, approve it",
					"   - (b) No",
				].join("\n"),
			),
			message(
				"user",
				"> **Do you approve adding the trust store?**\n\n- (a) Yes, approve it",
			),
		]);
		const clean = extractConversationDecisions(approvedCleanly, "/repo", AT);
		expect(clean).toHaveLength(1);
		expect(clean[0]).toMatchObject({
			kind: "approval",
			source: "plan",
			outcome: "kept",
		});

		const sentBack = stateWithModel([
			message(
				"agent",
				[
					"## 📝 Plan: add trust store",
					"",
					"**Goal:** Missing trust tracking.",
					"",
					"1. Do you approve adding the trust store?",
					"   - (a) Yes, approve it",
					"   - (b) No",
				].join("\n"),
			),
			message("user", "Please store it per project instead of globally."),
		]);
		const rejected = extractConversationDecisions(sentBack, "/repo", AT);
		expect(rejected).toHaveLength(1);
		expect(rejected[0]).toMatchObject({
			kind: "approval",
			source: "plan",
			outcome: "overturned",
		});
	});

	it("does not record anything for conversations with no questions", () => {
		const state = stateWithModel([
			message("user", "Fix the typo."),
			message("agent", "Done."),
		]);
		expect(extractConversationDecisions(state, "/repo", AT)).toEqual([]);
	});
});

describe("parseRevertCommit", () => {
	it("extracts reverted sha and subject from standard git revert commits", () => {
		expect(
			parseRevertCommit(
				'Revert "Add trust store"',
				"This reverts commit 1234567890abcdef.",
			),
		).toEqual({
			sha: "1234567890abcdef",
			revertedSubject: "Add trust store",
		});
		expect(parseRevertCommit("Fix a bug", "Normal commit body")).toBeNull();
	});
});
