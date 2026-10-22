import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFs } from "webappwiz/system";
import { FakeFs } from "webappwiz/system/testing";
import { DirReplica, type Replica, S3Replica } from "./index";
import { FakeReplica, FakeS3 } from "./testing";

const made: string[] = [];
afterAll(async () => {
	for (const dir of made) {
		await rm(dir, { recursive: true, force: true });
	}
});

const KEYS = { accessKeyId: "AK", secretAccessKey: "SECRET" };

function bytes(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

// Every replica keeps the same promises, so the replicator runs the same
// against a bucket, a folder or a fake.
describe.each([
	{ provider: "a fake", open: async (): Promise<Replica> => new FakeReplica() },
	{
		provider: "a folder on a fake disk",
		open: async (): Promise<Replica> => new DirReplica("/backup", new FakeFs()),
	},
	{
		provider: "a folder on the disk",
		open: async (): Promise<Replica> => {
			const dir = await realpath(
				await mkdtemp(join(tmpdir(), "splates-replica-")),
			);
			made.push(dir);
			return new DirReplica(dir, new NodeFs());
		},
	},
	{
		provider: "an S3 bucket",
		open: async (): Promise<Replica> => {
			const s3 = new FakeS3("records", KEYS);
			s3.pageSize = 2;
			return new S3Replica({
				endpoint: "https://store.example",
				bucket: "records",
				prefix: "splates",
				credentials: async () => KEYS,
				fetch: s3.fetch,
			});
		},
	},
])("replica in $provider", ({ open }) => {
	it("gives back what was put", async () => {
		const replica = await open();

		await replica.put("values/tasks/1.md", bytes("first"));

		expect(await replica.get("values/tasks/1.md")).toEqual(bytes("first"));
	});

	it("gives null where nothing was put", async () => {
		const replica = await open();

		expect(await replica.get("values/none.json")).toBeNull();
	});

	it("lists what is under a key, nested too, sorted, with sizes and hashes", async () => {
		const replica = await open();
		await replica.put("values/tasks/2.md", bytes("second"));
		await replica.put("values/tasks/1.md", bytes("first"));
		await replica.put("values/hooks.json", bytes("{}"));
		await replica.put("logs/a.jsonl/1", bytes("x"));

		const listed = await replica.list("values");

		expect(listed).toEqual([
			{
				key: "values/hooks.json",
				size: 2,
				md5: "99914b932bd37a50b983c5e7c90ae93b",
			},
			{
				key: "values/tasks/1.md",
				size: 5,
				md5: "8b04d5e3775d298e78455efc5ca404d5",
			},
			{
				key: "values/tasks/2.md",
				size: 6,
				md5: "a9f0e61a137d86aa9db53465e0801612",
			},
		]);
	});

	it("lists everything under the empty key", async () => {
		const replica = await open();
		await replica.put("manifest.json", bytes("{}"));
		await replica.put("values/a", bytes("a"));

		const keys = (await replica.list("")).map((object) => object.key);

		expect(keys).toEqual(["manifest.json", "values/a"]);
	});

	it("deletes, and deleting nothing is no error", async () => {
		const replica = await open();
		await replica.put("values/a", bytes("a"));

		await replica.delete("values/a");
		await replica.delete("values/b");

		expect(await replica.list("")).toEqual([]);
	});

	it("keeps a key with spaces and symbols", async () => {
		const replica = await open();

		await replica.put("values/files/a b+c&d.png", bytes("img"));

		expect((await replica.list("values")).map((object) => object.key)).toEqual([
			"values/files/a b+c&d.png",
		]);
	});

	it("refuses a key that leaves it", async () => {
		const replica = await open();

		expect(replica.put("../elsewhere", bytes("x"))).rejects.toThrow(
			"not a storage key",
		);
	});
});
