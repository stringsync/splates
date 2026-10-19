import { describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer } from "webappwiz/time/testing";
import { ConversationLog, type Entry } from "./log";

const PATH = "/repo/.git/splates/conversations/1.jsonl";

/** `entries` read back from a log of them, after the conversation's start. */
async function replay(...entries: Entry[]) {
	const fs = new FakeFs();
	const start: Entry = {
		kind: "start",
		id: "1",
		agent: "fake",
		task: null,
		createdAt: "2026-10-19T00:00:00.000Z",
	};
	await fs.write(
		PATH,
		[start, ...entries].map((each) => `${JSON.stringify(each)}\n`).join(""),
	);
	return new ConversationLog(PATH, fs, new FakeTimer()).replay();
}

describe("ConversationLog", () => {
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
});
