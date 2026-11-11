import { describe, expect, test } from "bun:test";
import { NoopEvalLaunches } from "./noop-eval-launches";

describe("NoopEvalLaunches", () => {
	test("gives no batch a conversation", async () => {
		const launches = new NoopEvalLaunches();

		expect((await launches.batchConversations("/results")).size).toBe(0);
	});
});
