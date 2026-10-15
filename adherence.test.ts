import { beforeEach, describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { Adherence, condense } from "./adherence";
import type { ConversationState } from "./conversation-state";
import { conversation, message, tool } from "./dev/fixtures";
import { type Outcome, Outcomes } from "./outcomes";

const AT = "2026-10-14T10:00:00.000Z";

describe("Adherence", () => {
	let fs: FakeFs;
	let outcomes: Outcomes;
	let adherence: Adherence;

	beforeEach(() => {
		fs = new FakeFs();
		outcomes = new Outcomes("/home/.arbor/outcomes.jsonl", fs);
		adherence = new Adherence("/home/.arbor/adherence.jsonl", fs, outcomes);
	});

	const landed = (overrides: Partial<Outcome>): Outcome => ({
		project: "/repo",
		task: "upload-413",
		base: "main",
		ended: "merged",
		startedAt: AT,
		endedAt: AT,
		questionRounds: 0,
		reviewRounds: 0,
		failedMerges: 0,
		conversation: "c1",
		agent: null,
		model: null,
		...overrides,
	});

	it("condenses the agent's own words and commands, joining text streamed apart", () => {
		const state = merged();
		state.messages.push(
			message(
				"agent",
				tool({
					id: "t3",
					kind: "edit",
					edits: [{ path: "/r/a.ts", old: "", new: "x" }],
				}),
				tool({ id: "t4", command: "ls", parent: "t3" }),
				tool({ id: "t5", command: "false", status: "failed" }),
			),
			{ ...message("user", "queued for later"), queued: true },
		);

		expect(condense(state)).toEqual({
			handed: false,
			beats: [
				{ kind: "user", text: "fix the upload" },
				{
					kind: "run",
					command: "arbor add upload-413",
					output: "added upload-413",
					ok: true,
				},
				{ kind: "say", text: "## 🌱 Added upload-413" },
				{
					kind: "run",
					command: "arbor merge",
					output: "merged upload-413 onto main",
					ok: true,
				},
				{ kind: "say", text: "## ✅ Merged upload-413 onto main" },
				{ kind: "edit", paths: ["/r/a.ts"] },
				{ kind: "run", command: "false", output: "", ok: false },
			],
		});
	});

	it("keeps each conversation's scores as last judged, with the commits it merged", async () => {
		await outcomes.record(landed({ commits: ["One", "Two"] }));
		await outcomes.record(landed({ conversation: "other", commits: ["Fine"] }));

		await adherence.judge(merged(), "/repo", AT);

		expect(await adherence.list()).toEqual([
			{
				conversation: "c1",
				project: "/repo",
				agent: "claude",
				skill: "0.0.43",
				at: AT,
				scores: {
					"added-card": { passed: 1, failed: 0 },
					"report-title": { passed: 1, failed: 0 },
					squashed: { passed: 0, failed: 1 },
				},
			},
		]);
	});

	it("writes a line only when a turn changed the scores, the last standing", async () => {
		const state = merged();
		await adherence.judge(state, "/repo", AT);
		await adherence.judge(state, "/repo", AT);
		state.messages.push(
			message("user", "again"),
			message("agent", "- A?\n- B?"),
		);
		await adherence.judge(state, "/repo", AT);

		const lines = (await fs.read("/home/.arbor/adherence.jsonl"))
			.trim()
			.split("\n");
		expect(lines).toHaveLength(2);
		expect((await adherence.list())[0]?.scores["numbered-questions"]).toEqual({
			passed: 0,
			failed: 1,
		});
	});
});

/** A conversation that added a task, said so, merged it, and reported. */
function merged(id = "c1", skill: string | null = "0.0.43"): ConversationState {
	return conversation({
		id,
		skill,
		messages: [
			message("user", "fix the upload"),
			message(
				"agent",
				tool({
					id: "t1",
					command: "arbor add upload-413",
					output: "added upload-413",
				}),
				"## 🌱 Added ",
				"upload-413",
				tool({
					id: "t2",
					command: "arbor merge",
					output: "merged upload-413 onto main",
				}),
				"## ✅ Merged upload-413 onto main",
			),
		],
	});
}
