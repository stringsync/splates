import { expect, it } from "bun:test";
import { parseQueued, startsTask } from "./orchestration";

it("tells a start from a task from other commands", () => {
	expect(
		[
			"splates add work-1 --task 1",
			"bin/splates add x --task=1 --goal y",
			"splates add work-1 --task 12",
			"splates task show 1",
		].map((command) => startsTask(command, 1)),
	).toEqual([true, true, false, false]);
});

it("keeps the fields the checks read", () => {
	expect(
		parseQueued(
			'[{"id":1,"subject":"A","text":"t","lane":null,"blockedBy":[],"takenBy":null,"stage":"backlog"}]',
		),
	).toEqual([
		{
			id: 1,
			subject: "A",
			text: "t",
			lane: null,
			blockedBy: [],
			takenBy: null,
		},
	]);
});
