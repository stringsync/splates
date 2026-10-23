import { beforeEach, describe, expect, it } from "bun:test";
import type { Message } from "@stringsync/splates-server/conversations";
import type { Event } from "@stringsync/splates-server/records";
import { tool } from "./fixtures";
import { like } from "./thread-messages";

const at = (seconds: number) => new Date(seconds * 1000).toISOString();

const read = (id: string, when: string): Event =>
	({
		id,
		at: when,
		action: "note read",
		task: null,
		reason: null,
		conversation: "c1",
		path: `notes/${id}.md`,
		hash: null,
		tool: id,
		subagent: false,
	}) as Event;

describe("Notes read during a turn", () => {
	let message: Message;

	beforeEach(() => {
		message = {
			role: "agent",
			at: at(1),
			until: null,
			plan: null,
			parts: [
				tool({ id: "t1", at: at(1), until: at(2) }),
				tool({ id: "t2", at: at(3), until: at(4) }),
				tool({ id: "t3", at: at(5), until: at(6) }),
			],
		};
	});

	it("do not cut its work into rows", () => {
		const { content } = like(
			message,
			1,
			"c1",
			false,
			at(0),
			Number.POSITIVE_INFINITY,
			"alpha",
			[read("a", at(1.5)), read("b", at(3.5))],
		);
		const types = (typeof content === "string" ? [] : content).map(
			(part) => part.type,
		);

		expect(types.filter((type) => type === "data-work")).toHaveLength(1);
	});
});
