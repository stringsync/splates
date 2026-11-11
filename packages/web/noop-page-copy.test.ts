import { describe, expect, test } from "bun:test";
import { NoopPageCopy } from "./noop-page-copy";

describe("NoopPageCopy", () => {
	test("loads nothing, whatever it was asked to keep", async () => {
		const copy = new NoopPageCopy<string>();

		copy.keep(() => "kept");

		expect(await copy.load()).toBeNull();
	});
});
