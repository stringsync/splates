import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { add } from "./add";
import { dev, devPorts } from "./dev";
import type { Snapshot } from "./snapshot";
import { Testing } from "./testing";

async function readUntil(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	needle: string,
): Promise<string> {
	let text = "";
	while (!text.includes(needle)) {
		const { value, done } = await reader.read();
		if (done) {
			break;
		}
		text += new TextDecoder().decode(value);
	}
	return text;
}

describe("dev", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	/** Any port, so concurrent test files cannot collide on a fixed one. */
	const serving = async (
		body: (snapshot: () => Promise<Snapshot>, port: number) => Promise<void>,
	): Promise<void> => {
		const server = await dev(deps, { ports: OpenPortProvider.any() });
		try {
			await body(
				async () =>
					(await (
						await fetch(`http://localhost:${server.port}/api/snapshot`)
					).json()) as Snapshot,
				server.port,
			);
		} finally {
			await server.disposeAsync();
		}
	};

	it("moves up to an open port when the one it asks for is taken", async () => {
		const held = await dev(deps, { ports: OpenPortProvider.any() });

		try {
			const server = await dev(deps, { ports: devPorts(held.port) });

			try {
				expect(server.port).toBeGreaterThan(held.port);
			} finally {
				await server.disposeAsync();
			}
		} finally {
			await held.disposeAsync();
		}
	});

	it("serves each task's fields and its ARBOR.md as data", async () => {
		await deps.journal.record("add", "alpha", () => add(deps, "alpha"));
		const alpha = (await deps.service.find("alpha")).path;
		await deps.fs.write(
			`${alpha}/ARBOR.md`,
			"# alpha\n\n## Goal\nland it\n\n## Next\n- [ ] the rest\n",
		);

		await serving(async (snapshot) => {
			const { tasks } = await snapshot();

			expect(tasks).toHaveLength(1);
			expect(tasks[0]?.task).toBe("alpha");
			expect(tasks[0]?.branch).toBe("task/alpha");
			expect(tasks[0]?.status).toBe("working");
			expect(tasks[0]?.plan).toContain("- [ ] the rest");
		});
	});

	it("reports an escalated task with the reason a person has to read", async () => {
		await add(deps, "alpha");
		await (await deps.service.find("alpha")).save({
			status: "escalated",
			escalations: [{ reason: "needs a human", at: new Date().toISOString() }],
		});

		await serving(async (snapshot) => {
			const { tasks } = await snapshot();

			expect(tasks[0]?.status).toBe("escalated");
			expect(tasks[0]?.escalation).toBe("needs a human");
		});
	});

	it("reports a task whose worktree is gone as orphaned", async () => {
		await add(deps, "alpha");
		await deps.fs.rm((await deps.service.find("alpha")).path, {
			recursive: true,
			force: true,
		});

		await serving(async (snapshot) => {
			expect((await snapshot()).tasks[0]?.status).toBe("orphaned");
		});
	});

	it("serves the ARBOR.md verbatim, leaving the page to render it", async () => {
		await add(deps, "alpha");
		const alpha = (await deps.service.find("alpha")).path;
		await deps.fs.write(
			`${alpha}/ARBOR.md`,
			"# alpha\n\n## Next\n- [ ] drop <script>alert(1)</script>\n",
		);

		await serving(async (snapshot) => {
			// The server is a data source now: escaping is React's job, and a
			// server that pre-escaped would double-escape once it got there.
			expect((await snapshot()).tasks[0]?.plan).toContain(
				"<script>alert(1)</script>",
			);
		});
	});

	it("serves the page the browser asks for its assets from", async () => {
		await add(deps, "alpha");

		await serving(async (_snapshot, port) => {
			const html = await (await fetch(`http://localhost:${port}/`)).text();

			expect(html).toContain("<title>arbor</title>");
			expect(html).toContain(`<div id="root">`);
			expect(html).toContain(`href="/styles.css"`);
			expect(html).toContain(`src="/main.js"`);
		});
	});

	it("answers a path it does not serve with a 404", async () => {
		await add(deps, "alpha");

		await serving(async (_snapshot, port) => {
			const response = await fetch(`http://localhost:${port}/nope`);

			expect(response.status).toBe(404);
		});
	});

	it("serves the React app already bundled, with nothing left to fetch", async () => {
		await add(deps, "alpha");

		await serving(async (_snapshot, port) => {
			const response = await fetch(`http://localhost:${port}/main.js`);
			const js = await response.text();

			expect(response.headers.get("content-type")).toContain("text/javascript");
			// React is in the file rather than imported from anywhere, which is what
			// makes the page work with no network and no import map.
			expect(js).not.toContain('from "react"');
			// A name like `createRoot` can be minified away; the symbol React tags
			// its elements with is a string, and stays.
			expect(js).toContain("react.transitional.element");
			// The page's own markup reached the bundle, so this is the app and not
			// an empty entry module that failed to pull anything in.
			expect(js).toContain("arbor");
		});
	});

	it("serves the stylesheet Tailwind compiled, not the import that asks for it", async () => {
		await add(deps, "alpha");

		await serving(async (_snapshot, port) => {
			const css = await (
				await fetch(`http://localhost:${port}/styles.css`)
			).text();

			// Either at-rule surviving into the output means Tailwind did not run,
			// and the page would come out with no classes at all.
			expect(css).not.toContain('@import "tailwindcss"');
			expect(css).not.toContain("@tailwind utilities");
			expect(css).toContain("color-scheme: dark");
			// Real utilities, not just the theme block: Tailwind emits only the
			// classes it can see, and it compiles happily to nothing at all when it
			// is pointed at no sources. One class from the page and one from the
			// `Markdown` component beside it, since they are found by
			// separate `@source` lines.
			expect(css).toContain("max-w-xl");
			expect(css).toContain("list-disc");
		});
	});

	it("names every file of the page as a source for Tailwind", async () => {
		const dir = `${import.meta.dir}/dev`;
		const styles = await Bun.file(`${dir}/styles.css`).text();
		const listed = [...styles.matchAll(/^@source "\.\/(.+\.tsx)";$/gm)].map(
			([, file]) => file,
		);
		// A file left off compiles to a page missing its classes, with no error.
		const pages = [...new Bun.Glob("*.tsx").scanSync(dir)].filter(
			(file) => !file.includes(".test."),
		);

		// `main.tsx` only mounts the app, and has no classes to find.
		expect(listed.sort()).toEqual(
			pages.filter((file) => file !== "main.tsx").sort(),
		);
	});

	it("pushes over SSE when a task changes, and stays quiet when it does not", async () => {
		await add(deps, "alpha");

		await serving(async (_snapshot, port) => {
			const events = await fetch(`http://localhost:${port}/events`);
			const reader = (events.body ?? new ReadableStream()).getReader();
			await add(deps, "beta");

			// The poll only pushes on a change, so this drains the connect comment
			// and then blocks until the new task lands. A server that pushed nothing
			// fails here by timing the test out.
			const sse = await readUntil(reader, "data: changed");

			expect(sse).toContain("data: changed");
			await reader.cancel();
		});
	}, 15_000);

	/** A post the way the page makes one: same origin as the host it asked. */
	const post = (port: number, path: string, body: BodyInit, headers = {}) =>
		fetch(`http://127.0.0.1:${port}${path}`, {
			method: "POST",
			headers: { origin: `http://127.0.0.1:${port}`, ...headers },
			body,
		});

	it("serves a file a todo holds, and nothing else", async () => {
		await add(deps, "alpha");
		const tree = (await deps.service.find("alpha")).path;
		await deps.fs.writeBytes(`${tree}/page.png`, new Uint8Array([7]));
		const todo = await deps.todos.add("look", null, {
			files: [
				{ name: "shot.png", bytes: new Uint8Array([8]) },
				{ name: "trace.log", bytes: new Uint8Array([9]) },
			],
		});

		await serving(async (_snapshot, port) => {
			const file = (path: string) =>
				fetch(
					`http://127.0.0.1:${port}/api/file?${new URLSearchParams({ path })}`,
				);

			const shown = await file(todo.files[0] ?? "");
			expect(shown.status).toBe(200);
			expect(shown.headers.get("content-type")).toBe("image/png");
			expect(new Uint8Array(await shown.arrayBuffer())).toEqual(
				new Uint8Array([8]),
			);
			const stored = await file(todo.files[1] ?? "");
			expect(stored.status).toBe(200);
			expect(stored.headers.get("content-disposition")).toBe("attachment");
			expect((await file(`${tree}/page.png`)).status).toBe(404);
			expect((await file(`${deps.todos.dir}/1/../../../config`)).status).toBe(
				404,
			);
		});
	});

	/** A todo write the way the page makes one. */
	const todoForm = (
		subject: string | null,
		files: File[] = [],
		keep: string[] = [],
	) => {
		const form = new FormData();
		if (subject !== null) {
			form.set("subject", subject);
		}
		for (const file of files) {
			form.append("file", file);
		}
		for (const path of keep) {
			form.append("keep", path);
		}
		return form;
	};

	it("adds a todo, files and all", async () => {
		await serving(async (snapshot, port) => {
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
		});
	});

	it("moves a todo, leaving its words and files alone", async () => {
		await deps.todos.add("first", null);
		await deps.todos.add("second", null, {
			files: [{ name: "a.png", bytes: new Uint8Array([1]) }],
		});

		await serving(async (snapshot, port) => {
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

		await serving(async (snapshot, port) => {
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

			for (const [id, lane] of [
				[1, "new"],
				[2, 1],
				[3, 1],
			] as const) {
				expect(
					(await send("PUT", `/api/todos/${id}/lane`, { lane })).status,
				).toBe(200);
			}
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

	it("updates and removes a todo", async () => {
		const todo = await deps.todos.add("write docs", null, {
			files: [
				{ name: "a.png", bytes: new Uint8Array([1]) },
				{ name: "b.png", bytes: new Uint8Array([2]) },
			],
		});
		await deps.todos.add("above", null);
		const [kept, dropped] = todo.files;

		await serving(async (snapshot, port) => {
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
			expect(await deps.fs.exists(kept ?? "")).toBe(false);
			expect((await write("DELETE", "/api/todos/1")).status).toBe(404);
			expect((await write("DELETE", "/api/todos/nope")).status).toBe(400);
		});
	});

	it("refuses a write from another site", async () => {
		await serving(async (_snapshot, port) => {
			const response = await post(port, "/api/todos", todoForm("planted"), {
				origin: "https://evil.example",
			});

			expect(response.status).toBe(403);
			expect(await deps.todos.all()).toEqual([]);
		});
	});

	it("lists the paths a task's tree holds, for pointing an agent at one", async () => {
		await add(deps, "alpha");
		const tree = (await deps.service.find("alpha")).path;
		await deps.fs.mkdir(`${tree}/src/lib`);
		await deps.commit(tree, "src/lib/a.ts", "a\n", "add a");
		await deps.fs.write(`${tree}/src/new.ts`, "new\n");
		await deps.fs.write(`${tree}/.gitignore`, "*.log\n");
		await deps.fs.write(`${tree}/debug.log`, "noise\n");

		await serving(async (_snapshot, port) => {
			const paths = (task: string) =>
				fetch(
					`http://127.0.0.1:${port}/api/paths?${new URLSearchParams({ task })}`,
				);

			const listed = (await (await paths("alpha")).json()) as string[];
			expect(listed).toContain("src/");
			expect(listed).toContain("src/lib/");
			expect(listed).toContain("src/lib/a.ts");
			// New but not ignored, so an agent may well want pointing at it.
			expect(listed).toContain("src/new.ts");
			expect(listed).not.toContain("debug.log");
			// The main tree, where trunk is, has none of the task's work.
			expect((await (await paths("")).json()) as string[]).not.toContain(
				"src/lib/a.ts",
			);
			expect((await paths("nope")).status).toBe(404);
		});
	});

	it("refuses a host it was not told about, and serves one it was", async () => {
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			hosts: ["repo.arbor.example"],
		});
		try {
			const as = (host: string) =>
				fetch(`http://127.0.0.1:${server.port}/api/snapshot`, {
					headers: { host },
				});

			expect((await as("rebound.example")).status).toBe(403);
			expect((await as("repo.arbor.example")).status).toBe(200);
			expect((await as(`localhost:${server.port}`)).status).toBe(200);
		} finally {
			await server.disposeAsync();
		}
	});
});
