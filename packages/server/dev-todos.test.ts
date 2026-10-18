import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { post, serving, todoForm } from "./dev-testing";
import { Testing } from "./testing";

describe("dev todos", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("adds a todo, files and all", async () => {
		await serving(deps, async (snapshot, port) => {
			await post(port, "/api/todos", todoForm("lower"));
			const form = todoForm("write the docs", [new File(["x"], "notes.md")]);
			form.set("text", "the CLI first");
			form.set("position", "1");
			const response = await post(port, "/api/todos", form);

			expect(response.status).toBe(200);
			const [todo, lower] = (await snapshot()).todos;
			expect(todo).toMatchObject({
				subject: "write the docs",
				text: "the CLI first",
				position: 1,
			});
			expect(todo?.files[0]).toEndWith("-notes.md");
			expect(lower).toMatchObject({ subject: "lower", position: 2 });
			expect((await deps.journal.tail(1))[0]).toMatchObject({
				action: "todo add",
				todo: todo?.id,
				subject: "write the docs",
				lane: null,
				position: 1,
			});
		});
	});

	it("moves a todo, leaving its words and files alone", async () => {
		await deps.todos.add("first", null);
		await deps.todos.add("second", null, {
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

	it("links todos and arranges lanes, refusing a loop", async () => {
		await deps.todos.add("first", null);
		await deps.todos.add("second", null, { blockedBy: [1] });
		await deps.todos.add("third", null);

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
				(await snapshot()).todos.find((todo) => todo.id === id);

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

	it("updates, removes and puts back a todo", async () => {
		const todo = await deps.todos.add("write docs", null, {
			files: [
				{ name: "a.png", bytes: new Uint8Array([1]) },
				{ name: "b.png", bytes: new Uint8Array([2]) },
			],
		});
		await deps.todos.add("above", null);
		const [kept, dropped] = todo.files;

		await serving(deps, async (snapshot, port) => {
			const write = (method: string, path: string, body?: FormData) =>
				fetch(`http://127.0.0.1:${port}${path}`, {
					method,
					headers: { origin: `http://127.0.0.1:${port}` },
					body,
				});

			const form = todoForm("write the docs", [], [kept ?? ""]);
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
