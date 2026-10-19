import { describe, expect, it } from "bun:test";
import { DETAIL_CHARS } from "./classify";
import { classificationKey } from "./key";

describe("classificationKey", () => {
	it("is the same for what the judge reads alike, and differs otherwise", () => {
		const long = "x".repeat(DETAIL_CHARS);
		expect(classificationKey("s", long)).toBe(
			classificationKey("s", `${long}more`),
		);
		expect(classificationKey("s", "d")).not.toBe(classificationKey("t", "d"));
		expect(classificationKey("s", "d")).not.toBe(classificationKey("s", "e"));
	});
});
