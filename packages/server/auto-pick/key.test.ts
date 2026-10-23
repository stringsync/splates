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

it("invalidates old judgments, changed attachments and paths beyond the detail limit", () => {
	const oldKey = Bun.hash(JSON.stringify(["s", "d"])).toString(36);
	expect(classificationKey("s", "d")).not.toBe(oldKey);
	expect(classificationKey("s", "d")).not.toBe(
		Bun.hash(JSON.stringify([2, "s", "d", [], []])).toString(36),
	);
	expect(
		classificationKey("s", "d", [
			{ name: "screen.png", mimeType: "image/png" },
		]),
	).not.toBe(classificationKey("s", "d"));
	const detail = "x".repeat(DETAIL_CHARS);
	expect(classificationKey("s", `${detail} packages/web/main.tsx`)).not.toBe(
		classificationKey("s", detail),
	);
});
