import { beforeEach, describe, expect, it } from "bun:test";
import { S3Replica } from "./index";
import { FakeS3 } from "./testing";

describe("S3Replica", () => {
	const keys = { accessKeyId: "AK", secretAccessKey: "S" };
	let s3: FakeS3;
	beforeEach(() => {
		s3 = new FakeS3("records", keys);
	});

	it("says what the store answered when it refuses the keys", async () => {
		const replica = new S3Replica({
			endpoint: "https://store.example/",
			bucket: "records",
			credentials: async () => ({ ...keys, secretAccessKey: "WRONG" }),
			fetch: s3.fetch,
		});

		expect(replica.put("values/a", new Uint8Array([1]))).rejects.toThrow(
			"s3://records: PUT /records/values/a answered 403: SignatureDoesNotMatch",
		);
	});

	it("keeps everything under its prefix", async () => {
		const replica = new S3Replica({
			endpoint: "https://store.example",
			bucket: "records",
			prefix: "/splates/",
			credentials: async () => keys,
			fetch: s3.fetch,
		});

		await replica.put("values/a", new Uint8Array([1]));

		expect([...s3.objects.keys()]).toEqual(["splates/values/a"]);
	});
});
