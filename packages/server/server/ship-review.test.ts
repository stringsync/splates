import { describe, expect, it } from "bun:test";
import { readReview } from "./ship-review";

describe("readReview", () => {
	it("accepts an agent's structured proposal and failure evidence", () => {
		expect(
			readReview(
				'```json\n{"status":"done","proposed":"major","reasons":"Removing the public adapter breaks callers"}\n```',
			),
		).toMatchObject({ proposed: "major", status: "done" });
		expect(
			readReview(
				'{"status":"failed","proposed":null,"reasons":"The pinned tag is missing"}',
			).reasons,
		).toContain("tag is missing");
	});
	it("refuses missing evidence, prose and unsupported release types", () => {
		expect(() =>
			readReview('{"status":"done","proposed":"patch","reasons":""}'),
		).toThrow();
		expect(() =>
			readReview('{"status":"done","proposed":"auto","reasons":"guess"}'),
		).toThrow();
		expect(() => readReview("Release it as patch")).toThrow();
		expect(() => readReview("null")).toThrow();
	});
});
