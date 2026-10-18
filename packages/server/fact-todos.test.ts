import { describe, expect, it } from "bun:test";
import { addFactTodos } from "./fact-todos";
import type { Outcome } from "./outcomes";
import { Testing } from "./testing";
import { todoAdd } from "./todo-edit";

describe.concurrent("addFactTodos", () => {
	it("adds a todo for each finding of a merge, journaled, once", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "Conflicted in a.ts", null);
		await deps.outcomes.record(
			merged(deps.git.root, [
				{ kind: "gate", reason: "conflict", at: "", files: ["a.ts"] },
				{ kind: "stopped", at: "2026-10-14T09:30:00.000Z" },
			]),
		);

		await addFactTodos(deps, "alpha");
		await addFactTodos(deps, "alpha");

		expect(
			(await deps.todos.all()).map(({ id, subject, from, lane }) => ({
				id,
				subject,
				from,
				lane,
			})),
		).toEqual([
			{ id: 1, subject: "Conflicted in a.ts", from: null, lane: null },
			{ id: 2, subject: "You stopped a turn", from: "alpha", lane: null },
		]);
		expect(
			(await deps.journal.tail(10)).filter(
				(event) => event.action === "todo add",
			),
		).toMatchObject([
			{ task: "alpha", todo: 2, subject: "You stopped a turn" },
		]);
	});

	it("adds none for a task that never merged here", async () => {
		await using deps = await Testing.open();

		await addFactTodos(deps, "alpha");

		expect(await deps.todos.all()).toEqual([]);
	});
});

/** `alpha` merged in `project`, with `findings`. */
function merged(project: string, findings: Outcome["findings"]): Outcome {
	return {
		project,
		task: "alpha",
		base: "main",
		ended: "merged",
		startedAt: "2026-10-14T09:20:00.000Z",
		endedAt: "2026-10-14T10:00:00.000Z",
		questionRounds: 0,
		reviewRounds: 0,
		failedMerges: 0,
		conversation: null,
		agent: null,
		model: null,
		findings,
	};
}
