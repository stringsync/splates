import { describe, expect, it } from "bun:test";
import { Testing } from "../testing";
import { taskAdd } from "./task-edit";

/** The subjects in list order. */
async function order(deps: Testing): Promise<string[]> {
	return (await deps.tasks.all()).map((task) => task.subject);
}

describe.concurrent("task restore", () => {
	it("puts a discarded task back under its number, where it stood, with its files", async () => {
		await using deps = await Testing.open();
		const shot = `${deps.root}/shot.png`;
		await deps.fs.writeBytes(shot, new Uint8Array([1]));
		await taskAdd(deps, "first", null);
		const second = await taskAdd(deps, "second", null, {
			files: [shot],
			lane: "new",
		});
		await taskAdd(deps, "third", null, { blockedBy: [2] });
		await (await deps.tasks.find(2)).take("alpha");

		await (await deps.tasks.find(2)).discard();
		expect(await order(deps)).toEqual(["first", "third"]);
		const restored = await deps.tasks.restore(2);

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
		// What its removal held for the person waits on it again.
		expect((await deps.tasks.find(3)).state).toMatchObject({
			blockedBy: [2],
		});
		expect((await deps.tasks.find(3)).state.blockersLost).toBeUndefined();
		await expect(deps.tasks.restore(2)).toBail("not_found");
		await expect(deps.tasks.restore(9)).toBail("not_found");
	});
});
