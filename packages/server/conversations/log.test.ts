import { describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer } from "webappwiz/time/testing";
import { FsStorage } from "../storage";
import { ConversationLog, type Entry } from "./log";

describe("ConversationLog", () => {
	it.each([
		{
			kind: "notes-holdout",
			holdout: true,
			experiment: { version: "notes-v2", at: "2026-10-23T00:00:00.000Z" },
		},
		{ kind: "notes-holdout", holdout: false },
	] as const)(
		"ignores historical notes assignment %j while replaying",
		async (entry) => {
			const replayed = await replay(entry, {
				kind: "end",
				error: "later failure",
			});
			expect(replayed?.state.error).toBe("later failure");
			expect(replayed?.state).not.toHaveProperty("notesHoldout");
			expect(replayed?.state).not.toHaveProperty("notesExperiment");
		},
	);
	it("reads back a failed process's error while nothing has run since", async () => {
		const replayed = await replay({ kind: "end", error: "it fell over" });

		expect(replayed?.state.error).toBe("it fell over");
		expect(replayed?.state.status).toBe("failed");
	});

	it("puts a failure behind it once a later turn ran", async () => {
		const replayed = await replay(
			{ kind: "end", error: "the worker no longer runs it" },
			{ kind: "turn", running: true },
			{ kind: "turn", running: false },
		);

		expect(replayed?.state.error).toBeNull();
		expect(replayed?.state.status).toBe("stopped");
	});

	it("reads a start written as capped, before automatic was named, as automatic", async () => {
		const fs = new FakeFs();
		await fs.write(PATH, `${JSON.stringify({ ...START, capped: true })}\n`);

		expect((await logOn(fs).replay())?.state.automatic).toBe(true);
	});

	it("reads a hold written as queued, before heldForTask was named", async () => {
		const fs = new FakeFs();
		await fs.write(PATH, `${JSON.stringify({ ...START, queued: 7 })}\n`);
		expect((await logOn(fs).replay())?.state.heldForTask).toBe(7);

		await fs.write(
			PATH,
			`${JSON.stringify({ ...START, queued: 7 })}\n${JSON.stringify({ kind: "queued", queued: null })}\n`,
		);
		expect((await logOn(fs).replay())?.state.heldForTask).toBeNull();
	});

	it("keeps what it writes after a line a crash cut short", async () => {
		const fs = new FakeFs();
		await fs.write(PATH, `${JSON.stringify(START)}\n{"kind":"rena`);
		const log = logOn(fs);
		await log.replay();

		log.write({ kind: "rename", name: "Fixed" });
		await log.flush();

		expect((await logOn(fs).replay())?.state.name).toBe("Fixed");
	});
});

const PATH = "/repo/.git/splates/conversations/1.jsonl";

const START: Entry = {
	kind: "start",
	id: "1",
	agent: "fake",
	task: null,
	createdAt: "2026-10-19T00:00:00.000Z",
};

/** The log at `PATH`, as `splates server` opens it. */
function logOn(fs: FakeFs): ConversationLog {
	return new ConversationLog(
		new FsStorage("/repo/.git/splates/conversations", fs).log("1.jsonl"),
		new FakeTimer(),
	);
}

/** `entries` read back from a log of them, after the conversation's start. */
async function replay(...entries: Entry[]) {
	const fs = new FakeFs();
	await fs.write(
		PATH,
		[START, ...entries].map((each) => `${JSON.stringify(each)}\n`).join(""),
	);
	return logOn(fs).replay();
}
