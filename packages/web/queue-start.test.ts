import { expect, test } from "bun:test";
import { queuePrompt } from "@stringsync/splates-server/queue";
import { queueStartOf } from "./queue-start";

test("reads back the start of a task a queued lane started", () => {
	const text = `[SPLATES TASK fix-it]\n\n${queuePrompt({ id: 7, queuedBy: { by: "lane", lane: 3 } } as never)}`;
	expect(queueStartOf(text)).toEqual({ task: "fix-it", queued: 7, lane: 3 });
});

test("leaves a task the person queued as a message", () => {
	const text = `[SPLATES TASK fix-it]\n\n${queuePrompt({ id: 7, queuedBy: { by: "person" } } as never)}`;
	expect(queueStartOf(text)).toBeNull();
});
