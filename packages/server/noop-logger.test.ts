import { describe, expect, test } from "bun:test";
import { NoopLogger } from "./noop-logger";

describe("NoopLogger", () => {
	test("logs without throwing", () => {
		const log = new NoopLogger();

		expect(() => {
			log.info("hello");
			log.error("oops", 1);
		}).not.toThrow();
	});
});
