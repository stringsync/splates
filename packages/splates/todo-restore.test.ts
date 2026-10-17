import { describe, expect, it } from "bun:test";
import { Testing } from "./testing";
import { todoAdd } from "./todo-edit";

/** The subjects in list order. */
async function order(deps: Testing): Promise<string[]> {
	return (await deps.todos.all()).map((todo) => todo.subject);
}

describe.concurrent("todo restore", () => {
	it("puts a discarded todo back under its number, where it stood, with its files", async () => {
		await using deps = await Testing.open();
		const shot = `${deps.root}/shot.png`;
		await deps.fs.writeBytes(shot, new Uint8Array([1]));
		await todoAdd(deps, "first", null);
		const second = await todoAdd(deps, "second", null, {
			files: [shot],
			lane: "new",
		});
		await todoAdd(deps, "third", null, { blockedBy: [2] });
		await (await deps.todos.find(2)).take("alpha");

		await (await deps.todos.find(2)).discard();
		expect(await order(deps)).toEqual(["first", "third"]);
		const restored = await deps.todos.restore(2);

		expect(await order(deps)).toEqual(["first", "second", "third"]);
		expect(restored.state).toMatchObject({
			id: 2,
			takenBy: null,
			lane: second.lane,
			files: second.files,
		});
		expect(await deps.fs.readBytes(second.files[0] ?? "")).toEqual(
			new Uint8Array([1]),
		);
		// What waited on it stopped waiting when it went.
		expect((await deps.todos.find(3)).blockedBy).toEqual([]);
		await expect(deps.todos.restore(2)).toBail("not_found");
		await expect(deps.todos.restore(9)).toBail("not_found");
	});
});
