import { describe, expect, test } from "bun:test";
import { NoopStorage } from "./noop-storage";

describe("NoopStorage", () => {
	test("keeps nothing it is given", () => {
		const storage = new NoopStorage();

		storage.setItem("a", "1");

		expect([storage.getItem("a"), storage.key(0), storage.length]).toEqual([
			null,
			null,
			0,
		]);
	});
});
