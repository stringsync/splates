import { expect, test } from "bun:test";
import type { TaskRecord } from "@splates/server/board";
import { agentQueuedBy, chainWords, tokens } from "./agent-queued-mark";

test("tokens reads millions and thousands", () => {
	expect(tokens(1_800_000)).toBe("1.8M");
	expect(tokens(5_000_000)).toBe("5M");
	expect(tokens(820_000)).toBe("820k");
});

test("chainWords says the spend once read, or just chain", () => {
	expect(chainWords(undefined)).toBe("chain");
	expect(
		chainWords({
			name: "x",
			spent: 1_800_000,
			budget: 5_000_000,
			stopped: false,
		}),
	).toBe("chain 1.8M of 5M");
});

test("only an agent-queued task has provenance", () => {
	expect(
		agentQueuedBy({ queuedBy: { by: "person" } } as TaskRecord),
	).toBeNull();
	const by = {
		by: "agent",
		conversation: "c",
		task: "t",
		root: { conversation: "c", task: "t" },
	};
	expect(agentQueuedBy({ queuedBy: by } as TaskRecord)).toEqual(by as never);
});
