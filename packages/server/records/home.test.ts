import { describe, expect, it } from "bun:test";
import { Testing } from "../testing";

describe("ProjectHome", () => {
	it("copies the files of .git/splates into the database, each as the kind of record it is, and leaves them aside", async () => {
		await using deps = await Testing.open({ init: false });
		const old = deps.splatesDir;
		await deps.fs.mkdir(`${old}/tasks`, { recursive: true });
		await deps.fs.mkdir(`${old}/log`, { recursive: true });
		await deps.fs.mkdir(`${old}/conversations/c1/attached`, {
			recursive: true,
		});
		await deps.fs.write(`${old}/format`, "4\n");
		await deps.fs.write(`${old}/merge.lock`, "pid");
		await deps.fs.write(`${old}/tasks/1.md`, "task one");
		await deps.fs.write(`${old}/log.jsonl`, '{"n":1}\n{"n":2}\n{"n":');
		await deps.fs.write(`${old}/log/100-a.jsonl`, '{"n":0}\n');
		await deps.fs.write(`${old}/conversations/c1.jsonl`, '{"k":"start"}\n');
		await deps.fs.writeBytes(
			`${old}/conversations/c1/attached/a.png`,
			new Uint8Array([1, 2, 3]),
		);

		await deps.records.import(old, 5);

		const database = await deps.records.open();
		expect(await database.collection("tasks").read("1.md")).toBe("task one");
		expect(
			await database.log("log.jsonl", { segments: "log" }).replay(),
		).toEqual([{ n: 1 }, { n: 2 }]);
		expect(
			await database.log("log.jsonl", { segments: "log" }).segments(),
		).toEqual([{ name: "100-a.jsonl", at: 100 }]);
		expect(await database.log("conversations/c1.jsonl").replay()).toEqual([
			{ k: "start" },
		]);
		expect(
			await database.collection("conversations/c1/attached").readBytes("a.png"),
		).toEqual(new Uint8Array([1, 2, 3]));
		expect(await database.document<number>("format").read()).toBe(5);
		expect(await database.collection("").read("merge.lock")).toBeNull();

		await deps.records.leaveAside(old);
		expect(await deps.fs.exists(old)).toBe(false);
		expect(await deps.fs.exists(`${old}.moved/tasks/1.md`)).toBe(true);
	});
});
