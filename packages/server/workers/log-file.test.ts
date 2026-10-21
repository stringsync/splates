import { describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { FakeWallClock } from "webappwiz/time/testing";
import { FileLogger, LOG_FILE_BYTES } from "./log-file";

describe("FileLogger", () => {
	it("appends each line stamped with the time and its level, in the order said", async () => {
		const fs = new FakeFs();
		const log = new FileLogger(
			fs,
			"/home/worker.log",
			new FakeWallClock(Date.parse("2026-10-21T10:32:14.000Z")),
		);

		log.info("worker local joined", "unix:/home/worker.sock");
		log.error("lost it");
		await log.flushed();

		expect(await fs.read("/home/worker.log")).toBe(
			"2026-10-21T10:32:14.000Z info worker local joined unix:/home/worker.sock\n" +
				"2026-10-21T10:32:14.000Z error lost it\n",
		);
	});

	it("moves a full log aside to .1, replacing the one there, and starts afresh", async () => {
		const fs = new FakeFs();
		await fs.write("/home/worker.log", "x".repeat(LOG_FILE_BYTES - 10));
		await fs.write("/home/worker.log.1", "older");
		const log = new FileLogger(fs, "/home/worker.log", new FakeWallClock(0));

		log.info("one more line than fits");
		await log.flushed();

		expect(await fs.read("/home/worker.log")).toBe(
			"1970-01-01T00:00:00.000Z info one more line than fits\n",
		);
		expect((await fs.read("/home/worker.log.1")).length).toBe(
			LOG_FILE_BYTES - 10,
		);
	});
});
