import { expect, test } from "bun:test";
import type { ConversationState } from "@splates/server/conversations";
import { addedTasks } from "./queue-summary-card";

const add = (number: number, reason: string | null = null) => ({
	action: "task add",
	reason,
	number,
});

test("lists the tasks a conversation added, once each, skipping refused adds", () => {
	const events = [add(4), add(5, "refused"), add(6), add(4)];
	expect(
		addedTasks({ events } as unknown as Pick<ConversationState, "events">),
	).toEqual([4, 6]);
});
