import { describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { FsStorage } from "./index";
import { rotated } from "./testing";

describe("FsStorage", () => {
	it("keeps a document in the file its key names, as stores kept it", async () => {
		const fs = new FakeFs();
		await fs.write("/home/s/push.json", '{"on":false}\n');
		const settings = new FsStorage("/home/s", fs).document<{ on: boolean }>(
			"push.json",
		);

		await settings.update((current) => ({ on: !current?.on }));

		expect(await fs.read("/home/s/push.json")).toBe('{\n\t"on": true\n}\n');
	});

	it("keeps a log's segments where the journal keeps its", async () => {
		const fs = new FakeFs();
		const log = new FsStorage("/repo/.git/splates", fs).log("log.jsonl", {
			segments: "log",
		});
		await log.append({ action: "add" });

		const segment = await rotated(log);

		expect(await fs.readdir("/repo/.git/splates/log")).toEqual([segment?.name]);
	});

	it("leaves no file behind of a write in flight", async () => {
		const fs = new FakeFs();
		const tasks = new FsStorage("/repo/.git/splates", fs).collection("tasks");

		await tasks.write("1.md", "first");

		expect(await fs.readdir("/repo/.git/splates/tasks")).toEqual(["1.md"]);
	});
});
