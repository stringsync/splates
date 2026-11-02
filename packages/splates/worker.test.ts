import { expect, test } from "bun:test";
import { handoffWorker } from "@splates/server/workers";
import { workerRunId } from "./worker";

test("worker run takes the id a server hands a stand-in", () => {
	expect(workerRunId.parse(handoffWorker("1.13.10"))).toBe("local-1.13.10");
	expect(workerRunId.parse("local")).toBe("local");
});

test("worker run refuses any other id", () => {
	expect(workerRunId.safeParse("remote").success).toBe(false);
	expect(workerRunId.safeParse("").success).toBe(false);
});
