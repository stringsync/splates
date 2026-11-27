import { describe, expect, test } from "bun:test";
import type { ThreadMessageLike } from "@assistant-ui/react";
import type { PermissionProposal } from "@splates/server/plans";
import { supersedeQueues } from "./superseded-queues";

describe("supersedeQueues", () => {
	test("folds an earlier card for the same lane", () => {
		expect(folded([card({ lane: 3 }), card({ lane: 3 })])).toEqual([
			true,
			false,
		]);
	});

	test("never folds cards for tasks", () => {
		expect(folded([card({ tasks: [1, 2] }), card({ tasks: [2] })])).toEqual([
			false,
			false,
		]);
	});

	test("keeps cards for another lane or project", () => {
		expect(folded([card({ lane: 3 }), card({ lane: 4 })])).toEqual([
			false,
			false,
		]);
		expect(
			folded([card({ lane: 3 }), card({ lane: 3, project: "wren" })]),
		).toEqual([false, false]);
	});

	test("ignores other permission actions", () => {
		expect(
			folded([card({ lane: 3 }), card({ lane: 3, action: "remove-lane" })]),
		).toEqual([false, false]);
	});
});

function card(over: Partial<PermissionProposal>): ThreadMessageLike {
	const permission: PermissionProposal = {
		action: "queue",
		lane: null,
		tasks: [],
		title: null,
		body: "",
		...over,
	};
	return {
		role: "assistant",
		content: [{ type: "data-permission", data: { permission } }],
	};
}

function folded(thread: ThreadMessageLike[]): boolean[] {
	return supersedeQueues(thread).map((message) => {
		const part = (
			message.content as unknown as { data: { superseded?: boolean } }[]
		)[0];
		return part?.data.superseded === true;
	});
}
