import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { post, serving, taskForm } from "../server/testing";
import { Testing } from "../testing";

describe("dev tasks", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("adds a task, files and all", async () => {
		await serving(deps, async (snapshot, port) => {
			await post(port, "/api/todos", taskForm("lower"));
			const form = taskForm("write the docs", [new File(["x"], "notes.md")]);
			form.set("text", "the CLI first");
			form.set("position", "1");
			const response = await post(port, "/api/todos", form);

			expect(response.status).toBe(200);
			const [task, lower] = (await snapshot()).todos;
			expect(task).toMatchObject({
				subject: "write the docs",
				text: "the CLI first",
				position: 1,
			});
			expect(task?.files[0]).toEndWith("-notes.md");
			expect(lower).toMatchObject({ subject: "lower", position: 2 });
			expect((await deps.journal.tail(1))[0]).toMatchObject({
				action: "task add",
				number: task?.id,
				subject: "write the docs",
				lane: null,
				position: 1,
			});
		});
	});

	it("moves a task, leaving its words and files alone", async () => {
		await deps.tasks.add("first", null);
		await deps.tasks.add("second", null, {
			files: [{ name: "a.png", bytes: new Uint8Array([1]) }],
		});

		await serving(deps, async (snapshot, port) => {
			const move = (path: string, position: unknown) =>
				fetch(`http://127.0.0.1:${port}${path}`, {
					method: "PUT",
					headers: {
						origin: `http://127.0.0.1:${port}`,
						"content-type": "application/json",
					},
					body: JSON.stringify({ position }),
				});

			expect((await move("/api/todos/2/position", 1)).status).toBe(200);
			const [top] = (await snapshot()).todos;
			expect(top).toMatchObject({ id: 2, subject: "second", position: 1 });
			expect(top?.files).toHaveLength(1);
			expect((await move("/api/todos/2/position", 0)).status).toBe(400);
			expect((await move("/api/todos/9/position", 1)).status).toBe(404);
		});
	});

	it("queues a task, moves it up the queue, and takes it out again", async () => {
		await deps.tasks.add("first", null);
		await deps.tasks.add("second", null);

		await serving(deps, async (snapshot, port) => {
			const put = (path: string, body: object) =>
				fetch(`http://127.0.0.1:${port}${path}`, {
					method: "PUT",
					headers: {
						origin: `http://127.0.0.1:${port}`,
						"content-type": "application/json",
					},
					body: JSON.stringify(body),
				});
			const stages = async () =>
				(await snapshot()).todos.map(({ id, stage }) => [id, stage]);

			expect((await put("/api/todos/1/queued", { queued: true })).status).toBe(
				200,
			);
			expect((await put("/api/todos/2/queued", { queued: true })).status).toBe(
				200,
			);
			expect(await stages()).toEqual([
				[1, "queued"],
				[2, "queued"],
			]);
			expect((await deps.journal.tail(1))[0]).toMatchObject({
				action: "queue add",
			});

			expect(
				(await put("/api/todos/2/queue-position", { position: 1 })).status,
			).toBe(200);
			expect((await snapshot()).todos.map(({ id }) => id)).toEqual([2, 1]);

			expect((await put("/api/todos/2/queued", { queued: false })).status).toBe(
				200,
			);
			expect(await stages()).toEqual([
				[2, "backlog"],
				[1, "queued"],
			]);
			expect(
				(await put("/api/todos/2/queue-position", { position: 1 })).status,
			).toBe(404);
			expect((await put("/api/todos/1/queued", {})).status).toBe(400);
		});
	});

	it("links tasks and arranges lanes, refusing a loop", async () => {
		await deps.tasks.add("first", null);
		await deps.tasks.add("second", null, { blockedBy: [1] });
		await deps.tasks.add("third", null);

		await serving(deps, async (snapshot, port) => {
			const send = (method: string, path: string, body: unknown = {}) =>
				fetch(`http://127.0.0.1:${port}${path}`, {
					method,
					headers: {
						origin: `http://127.0.0.1:${port}`,
						"content-type": "application/json",
					},
					body: JSON.stringify(body),
				});
			const state = async (id: number) =>
				(await snapshot()).todos.find((task) => task.id === id);

			const loop = await send("PUT", "/api/todos/1/blocked-by", {
				blockedBy: [2],
			});
			expect(loop.status).toBe(409);
			expect((await loop.json()).reason).toBe("cycle");
			expect(
				(await send("PUT", "/api/todos/3/blocked-by", { blockedBy: [2] }))
					.status,
			).toBe(200);
			expect((await state(3))?.blockedBy).toEqual([2]);

			expect([
				(await send("PUT", "/api/todos/1/lane", { lane: "new" })).status,
				(await send("PUT", "/api/todos/2/lane", { lane: 1 })).status,
				(await send("PUT", "/api/todos/3/lane", { lane: 1 })).status,
			]).toEqual([200, 200, 200]);
			expect(
				(await send("PUT", "/api/todos/3/lane", { lane: "new" })).status,
			).toBe(200);
			expect((await state(3))?.lane).toBe(2);
			expect(
				(await send("POST", "/api/lanes/2/join", { into: 1 })).status,
			).toBe(200);
			expect(
				(
					await send("PUT", "/api/todos/2/lane", {
						lane: "new",
						name: "Second",
					})
				).status,
			).toBe(200);
			expect((await state(2))?.lane).toBe(3);
			expect((await snapshot()).lanes.at(-1)).toEqual({
				id: 3,
				name: "Second",
			});
			expect((await send("DELETE", "/api/lanes/3")).status).toBe(200);
			expect((await state(2))?.lane).toBeNull();
			expect((await send("DELETE", "/api/lanes/9")).status).toBe(404);

			const added = await send("POST", "/api/lanes", { name: "Docs" });
			expect(await added.json()).toEqual({ id: 4, name: "Docs" });
			expect(
				(await send("PUT", "/api/lanes/4", { name: "Guides" })).status,
			).toBe(200);
			expect(
				(await send("PUT", "/api/lanes/1", { name: "guides" })).status,
			).toBe(409);
			expect((await snapshot()).lanes.at(-1)).toEqual({
				id: 4,
				name: "Guides",
			});

			const moved = await send("PUT", "/api/lanes/4", { position: 1 });
			expect(await moved.json()).toEqual({ id: 4, name: "Guides" });
			expect((await snapshot()).lanes[0]).toEqual({ id: 4, name: "Guides" });
			expect((await send("PUT", "/api/lanes/4", { position: 0 })).status).toBe(
				400,
			);
		});
	});

	it("keeps a blocker removed without merging while the page's list names it", async () => {
		await deps.tasks.add("first", null);
		await deps.tasks.add("second", null);
		await deps.tasks.add("third", null, { blockedBy: [1] });
		await (await deps.tasks.find(1)).remove();

		await serving(deps, async (snapshot, port) => {
			const link = (blockedBy: number[]) =>
				fetch(`http://127.0.0.1:${port}/api/todos/3/blocked-by`, {
					method: "PUT",
					headers: {
						origin: `http://127.0.0.1:${port}`,
						"content-type": "application/json",
					},
					body: JSON.stringify({ blockedBy }),
				});
			const state = async () =>
				(await snapshot()).todos.find((task) => task.id === 3);

			expect((await link([1, 2])).status).toBe(200);
			expect(await state()).toMatchObject({
				blockedBy: [2],
				blockersLost: [{ id: 1, subject: "first" }],
			});
			expect((await link([2])).status).toBe(200);
			expect((await state())?.blockersLost).toBeUndefined();
		});
	});

	it("updates, removes and puts back a task", async () => {
		const task = await deps.tasks.add("write docs", null, {
			files: [
				{ name: "a.png", bytes: new Uint8Array([1]) },
				{ name: "b.png", bytes: new Uint8Array([2]) },
			],
		});
		await deps.tasks.add("above", null);
		const [kept, dropped] = task.files;

		await serving(deps, async (snapshot, port) => {
			const write = (method: string, path: string, body?: FormData) =>
				fetch(`http://127.0.0.1:${port}${path}`, {
					method,
					headers: { origin: `http://127.0.0.1:${port}` },
					body,
				});

			const form = taskForm("write the docs", [], [kept ?? ""]);
			form.set("position", "2");
			const updated = await write("PATCH", "/api/todos/1", form);
			expect(updated.status).toBe(200);
			expect((await snapshot()).todos[1]).toMatchObject({
				id: 1,
				subject: "write the docs",
				position: 2,
				files: [kept],
			});
			expect(await deps.fs.exists(dropped ?? "")).toBe(false);

			expect((await write("DELETE", "/api/todos/1")).status).toBe(200);
			expect((await snapshot()).todos).toMatchObject([
				{ subject: "above", position: 1 },
			]);
			// Kept, for the line it was added on to put it back.
			expect(await deps.fs.exists(kept ?? "")).toBe(true);
			expect((await write("DELETE", "/api/todos/1")).status).toBe(404);

			expect((await write("POST", "/api/todos/1/restore")).status).toBe(200);
			expect((await snapshot()).todos).toMatchObject([
				{ subject: "above", position: 1 },
				{ id: 1, subject: "write the docs", position: 2, files: [kept] },
			]);
			expect((await write("POST", "/api/todos/1/restore")).status).toBe(404);
			expect((await write("DELETE", "/api/todos/nope")).status).toBe(400);
		});
	});
});
