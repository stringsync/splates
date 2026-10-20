import { describe, expect, it } from "bun:test";
import { taskName } from "./name";

const NAMES: ReadonlySet<string> = new Set();

describe("taskName", () => {
	it("names a task for its queued task's words, cut at a word, numbered past a name taken", () => {
		expect(
			taskName({ subject: "Upload retries forever on a 413" }, NAMES),
		).toBe("upload-retries-forever-on-a-413");
		expect(
			taskName(
				{
					subject:
						"Server starts a running lane's unblocked queued tasks on its own, always",
				},
				NAMES,
			),
		).toBe("server-starts-a-running-lane-s-unblocked");
		expect(
			taskName({ subject: "Fix it" }, new Set(["fix-it", "fix-it-2"])),
		).toBe("fix-it-3");
		expect(taskName({ subject: "!!!" }, NAMES)).toBe("task");
	});

	it("names a task for the slug its queued task was given, numbered past a name taken", () => {
		const queued = {
			subject: "Upload retries forever on a 413",
			slug: "upload-413",
		};
		expect(taskName(queued, NAMES)).toBe("upload-413");
		expect(taskName(queued, new Set(["upload-413"]))).toBe("upload-413-2");
	});
});
