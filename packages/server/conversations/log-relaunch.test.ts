import { beforeEach, describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer } from "webappwiz/time/testing";
import { FsStorage } from "../storage";
import { ConversationLog, type Entry, LOG_FORMAT } from "./log";

describe("ConversationLog, relaunched after the last process's frame 40", () => {
	let fs: FakeFs;
	let timer: FakeTimer;
	let log: ConversationLog;
	beforeEach(async () => {
		fs = new FakeFs();
		timer = new FakeTimer();
		await fs.write(PATH, `${JSON.stringify(START)}\n`);
		log = logOn(fs, timer);
		await log.replay();
		log.heard(40);
		log.write({ kind: "end", error: null });
	});

	it("holds none of the new process's frames until it writes one", async () => {
		await log.flush();

		log.relaunched();

		expect(log.savedThrough).toBe(0);
		log.heard(3);
		log.write({ kind: "turn", running: true });
		await log.flush();
		expect(log.savedThrough).toBe(3);
	});

	it("lets a save of the last process's entries move no seq of the new one's", async () => {
		timer.fireTimeouts();

		log.relaunched();
		await log.flush();

		expect(log.savedThrough).toBe(0);
	});

	it("is taken back after a restart at the seq it acked the worker through", async () => {
		log.relaunched();
		log.write({ kind: "request", id: 0, method: "initialize" });
		log.heard(2);
		log.write({
			kind: "launched",
			handle: { worker: "local", channel: 2 },
			steers: true,
			sees: true,
			follows: true,
			format: LOG_FORMAT,
		});
		await log.flush();

		expect((await logOn(fs, timer).replay())?.live?.held).toBe(
			log.savedThrough,
		);
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
function logOn(fs: FakeFs, timer: FakeTimer): ConversationLog {
	return new ConversationLog(
		new FsStorage("/repo/.git/splates/conversations", fs).log("1.jsonl"),
		timer,
	);
}
