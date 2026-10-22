import { describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { FsStorage } from "./index";

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

	it("reads a document another writer moves into place while it looks", async () => {
		// The read finds no file, then the other writer's rename lands before
		// it checks whether one is there.
		class Racing extends FakeFs {
			override async read(path: string): Promise<string> {
				const read = super.read(path);
				await read.catch(() => super.write(path, '{"on":true}\n'));
				return read;
			}
		}
		const fs = new Racing();
		const settings = new FsStorage("/home/s", fs).document<{ on: boolean }>(
			"push.json",
		);

		expect(await settings.read()).toEqual({ on: true });
	});

	it("keeps a line torn by a crash apart from the next appended", async () => {
		const fs = new FakeFs();
		await fs.write("/home/s/log.jsonl", '{"n":1}\n{"n":');
		const log = new FsStorage("/home/s", fs).log("log.jsonl");

		expect(await log.replay()).toEqual([{ n: 1 }]);
		await log.append({ n: 2 });

		expect(await log.replay()).toEqual([{ n: 1 }, { n: 2 }]);
	});

	it("makes the directory a log is kept in", async () => {
		const fs = new FakeFs();
		const log = new FsStorage("/home/s", fs).log("conversations/a.jsonl");

		await log.append({ n: 1 });

		expect(await fs.read("/home/s/conversations/a.jsonl")).toBe('{"n":1}\n');
	});

	it("leaves no file behind of a write in flight", async () => {
		const fs = new FakeFs();
		const tasks = new FsStorage("/home/s", fs).collection("tasks");

		await tasks.write("1.md", "first");

		expect(await fs.readdir("/home/s/tasks")).toEqual(["1.md"]);
	});
});
