import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { add } from "./add";
import { Conversations } from "./conversations";
import { dev, devPorts } from "./dev";
import type { FileDiff } from "./diff";
import { AGENT, FakeAgent, heard, ROSTERED, say } from "./fake-agent";
import { CHECKPOINT, RESUME } from "./prompts";
import type { Snapshot } from "./snapshot";
import { RESTART } from "./supervise";
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

/**
 * Whether `reader` says `needle` within `ms`. A server that could watch the
 * repo never polls it, so a change it hears of there came from a watch,
 * however long a loaded machine took to tell it.
 */
async function within(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	needle: string,
	ms: number,
): Promise<boolean> {
	const deadline = Bun.sleep(ms).then(() => false);
	return Promise.race([
		readUntil(reader, needle).then((text) => text.includes(needle)),
		deadline,
	]);
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

	it("refuses every request once a newer arbor has moved the records on", async () => {
		await serving(async (snapshot, port) => {
			expect((await snapshot()).tasks).toEqual([]);
			await deps.fs.write(`${deps.arborDir}/format`, "2\n");

			const response = await fetch(`http://localhost:${port}/api/snapshot`);

			expect(response.status).toBe(409);
			expect(await response.text()).toContain("bunx @webappwiz/arbor@latest");
		});
	});

	describe("projects", () => {
		/** A second repository, registered after the one the server runs in. */
		const another = async () => {
			const other = await Testing.open();
			await deps.projects.register(deps.root);
			await deps.projects.register(other.root);
			return other;
		};

		const write = (port: number, path: string, method: string, body = {}) =>
			fetch(`http://127.0.0.1:${port}${path}`, {
				method,
				headers: {
					origin: `http://127.0.0.1:${port}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(body),
			});

		it("serves another registered project by its slug, writes and all", async () => {
			await using other = await another();

			await serving(async (snapshot, port) => {
				const form = new FormData();
				form.set("subject", "over there");
				const added = await fetch(
					`http://127.0.0.1:${port}/api/todos?project=repo-2`,
					{
						method: "POST",
						headers: { origin: `http://127.0.0.1:${port}` },
						body: form,
					},
				);
				expect(added.status).toBe(200);

				const there = (await (
					await fetch(`http://localhost:${port}/api/snapshot?project=repo-2`)
				).json()) as Snapshot;
				expect(there.path).toBe(other.root);
				expect(there.todos.map((todo) => todo.subject)).toEqual(["over there"]);
				expect((await snapshot()).todos).toEqual([]);
				expect((await other.todos.all()).map((todo) => todo.subject)).toEqual([
					"over there",
				]);
			});
		});

		it("refuses to start in a project `arbor init` never registered", async () => {
			await deps.projects.forget(deps.root);

			await expect(dev(deps, { ports: OpenPortProvider.any() })).toBail(
				"uninitialized",
				{ message: "Run `arbor init` in it once" },
			);
		});

		it("lists the projects, and forgets a gone one but never its own", async () => {
			await using _other = await another();
			await deps.projects.register("/nowhere/gone");

			await serving(async (_, port) => {
				const list = async () =>
					(
						(await (
							await fetch(`http://localhost:${port}/api/projects`)
						).json()) as {
							projects: { slug: string; gone: boolean; here: boolean }[];
						}
					).projects;
				expect(await list()).toMatchObject([
					{ slug: "repo", gone: false, here: true },
					{ slug: "repo-2", gone: false, here: false },
					{ slug: "gone", gone: true, here: false },
				]);
				expect(
					(await fetch(`http://localhost:${port}/api/snapshot?project=gone`))
						.status,
				).toBe(404);
				expect(
					(await fetch(`http://localhost:${port}/api/snapshot?project=none`))
						.status,
				).toBe(404);

				expect((await write(port, "/api/projects/gone", "DELETE")).status).toBe(
					200,
				);
				expect((await write(port, "/api/projects/repo", "DELETE")).status).toBe(
					400,
				);
				expect((await list()).map((each) => each.slug)).toEqual([
					"repo",
					"repo-2",
				]);
			});
		});

		it("counts the agents waiting on the person in each project, opened or not", async () => {
			await using other = await another();
			const escalate = async (project: typeof other, task: string) => {
				await add(project, task);
				await (await project.service.find(task)).save({
					status: "escalated",
					escalations: [
						{ reason: "needs a human", at: new Date().toISOString() },
					],
				});
			};
			await escalate(other, "beta");
			await escalate(other, "gamma");
			await add(other, "delta");

			await serving(async (_, port) => {
				const waiting = async () =>
					(
						(await (
							await fetch(`http://localhost:${port}/api/projects`)
						).json()) as { projects: { slug: string; waiting: number }[] }
					).projects.map(({ slug, waiting }) => [slug, waiting]);
				expect(await waiting()).toEqual([
					["repo", 0],
					["repo-2", 2],
				]);

				await escalate(deps, "alpha");
				expect(await waiting()).toEqual([
					["repo", 1],
					["repo-2", 2],
				]);
			});
		});

		it("finds a conversation by its id in the project it started in", async () => {
			await using other = await another();
			const agent = new FakeAgent();
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: ({ arborDir }) =>
					new Conversations(`${arborDir}/conversations`, [AGENT], {
						launch: agent.launch,
					}),
			});
			try {
				const { port } = server;
				const started = await write(
					port,
					"/api/conversations?project=repo-2",
					"POST",
					{ agent: "fake" },
				);
				const { id } = (await started.json()) as { id: string };
				expect(agent.launched[0]?.cwd).toBe(other.root);

				// As the agent's own `arbor` would, naming no project.
				const renamed = await write(
					port,
					`/api/conversations/${id}/name`,
					"PUT",
					{
						name: "Elsewhere",
					},
				);
				expect(await renamed.json()).toMatchObject({ id, name: "Elsewhere" });
				const listed = async (query: string) =>
					(
						(await (
							await fetch(`http://localhost:${port}/api/conversations${query}`)
						).json()) as { conversations: { id: string }[] }
					).conversations.map((each) => each.id);
				expect(await listed("?project=repo-2")).toEqual([id]);
				expect(await listed("")).toEqual([]);
			} finally {
				await server.disposeAsync();
			}
		}, 15_000);

		it("refuses to forget a project with a conversation under way", async () => {
			await using _other = await another();
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: ({ arborDir }) =>
					new Conversations(`${arborDir}/conversations`, [AGENT], {
						launch: new FakeAgent().launch,
					}),
			});
			try {
				const { port } = server;
				await write(port, "/api/conversations?project=repo-2", "POST", {
					agent: "fake",
				});

				const refused = await write(port, "/api/projects/repo-2", "DELETE");
				expect(refused.status).toBe(400);
				expect(await refused.json()).toMatchObject({
					message: expect.stringContaining("stop fake first"),
				});
				expect((await deps.projects.list()).map((each) => each.slug)).toEqual([
					"repo",
					"repo-2",
				]);
			} finally {
				await server.disposeAsync();
			}
		}, 15_000);
	});

	it("reads the repo only while a page listens", async () => {
		const list = spyOn(deps.service, "list");

		await serving(async (_, port) => {
			const opened = list.mock.calls.length;
			await Bun.sleep(2_200);
			expect(list.mock.calls.length).toBe(opened);

			const events = await fetch(`http://localhost:${port}/events`);
			const reader = events.body?.getReader();
			await Bun.sleep(2_200);
			expect(list.mock.calls.length).toBeGreaterThan(opened);
			await reader?.cancel();
		});
		list.mockRestore();
	}, 15_000);

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

	describe("watching", () => {
		/** The page's stream of changes, once it has connected. */
		const listen = async (port: number) => {
			const events = await fetch(`http://localhost:${port}/events`);
			const reader = (events.body ?? new ReadableStream()).getReader();
			await readUntil(reader, ": connected");
			return reader;
		};

		it("hears of an ARBOR.md, a commit and a todo as they change, without polling", async () => {
			await add(deps, "alpha");
			const tree = (await deps.service.find("alpha")).path;

			await serving(async (_, port) => {
				const reader = await listen(port);

				await deps.fs.write(
					`${tree}/ARBOR.md`,
					"# alpha\n\n## Goal\n\nmoved\n",
				);
				expect(await within(reader, "data: changed", 5_000)).toBe(true);
				await deps.commit(tree, "a.txt", "a\n", "add a");
				expect(await within(reader, "data: changed", 5_000)).toBe(true);
				await deps.todos.add("later", null);
				expect(await within(reader, "data: changed", 5_000)).toBe(true);
				await reader.cancel();
			});
		}, 15_000);

		it("stays quiet while only a conversation's log grows", async () => {
			await deps.fs.mkdir(`${deps.arborDir}/conversations`);
			await serving(async (_, port) => {
				const reader = await listen(port);

				await deps.fs.write(
					`${deps.arborDir}/conversations/c1.jsonl`,
					'{"kind":"prompt","text":"hi"}\n',
				);
				expect(await within(reader, "data: changed", 500)).toBe(false);
				await reader.cancel();
			});
		});

		it("polls a repo it cannot watch, and says so", async () => {
			const fs = Object.assign(Object.create(deps.fs), {
				watch() {
					throw new Error("no watching here");
				},
			}) as typeof deps.fs;
			const server = await dev(
				{ ...deps, fs },
				{ ports: OpenPortProvider.any() },
			);
			try {
				const reader = await listen(server.port);
				expect(deps.out()).toContain("cannot watch");

				await deps.todos.add("later", null);
				expect(await within(reader, "data: changed", 10_000)).toBe(true);
				await reader.cancel();
			} finally {
				await server.disposeAsync();
			}
		}, 15_000);
	});

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

	it("serves a file a task holds in parts, but never its record", async () => {
		await add(deps, "alpha");
		const [clip = ""] = await deps.service
			.files("alpha")
			.store([{ name: "run.webm", bytes: new Uint8Array([1, 2, 3, 4]) }]);

		await serving(async (_snapshot, port) => {
			const file = (path: string, headers = {}) =>
				fetch(
					`http://127.0.0.1:${port}/api/file?${new URLSearchParams({ path })}`,
					{ headers },
				);

			const whole = await file(clip);
			expect(whole.status).toBe(200);
			expect(whole.headers.get("content-type")).toBe("video/webm");
			const part = await file(clip, { range: "bytes=1-2" });
			expect(part.status).toBe(206);
			expect(part.headers.get("content-range")).toBe("bytes 1-2/4");
			expect(new Uint8Array(await part.arrayBuffer())).toEqual(
				new Uint8Array([2, 3]),
			);
			const tail = await file(clip, { range: "bytes=-1" });
			expect(new Uint8Array(await tail.arrayBuffer())).toEqual(
				new Uint8Array([4]),
			);
			expect((await file(deps.service.recordPath("alpha"))).status).toBe(404);
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

	it("serves a task's diff against its base, its uncommitted edits too", async () => {
		await add(deps, "alpha");
		const tree = (await deps.service.find("alpha")).path;
		await deps.commit(tree, "a.ts", "a\n", "add a");
		await deps.fs.write(`${tree}/a.ts`, "a\nb\n");
		await deps.fs.write(`${tree}/b.ts`, "b\n");

		await serving(async (_snapshot, port) => {
			const diff = (task: string) =>
				fetch(`http://127.0.0.1:${port}/api/tasks/${task}/diff`);

			const files = (await (await diff("alpha")).json()) as FileDiff[];
			expect(
				files.map(({ path, added, uncommitted }) => [path, added, uncommitted]),
			).toEqual([
				["a.ts", 2, true],
				["b.ts", 1, true],
			]);
			expect((await diff("nope")).status).toBe(404);
		});
	});

	it("grants a task out of merge attempts another round, and only an escalated one", async () => {
		await add(deps, "alpha");
		await add(deps, "beta");
		await (await deps.service.find("alpha")).save({
			status: "escalated",
			mergeAttempts: deps.config.mergeRetryCount,
		});

		await serving(async (_snapshot, port) => {
			const retry = (task: string) =>
				fetch(`http://127.0.0.1:${port}/api/tasks/${task}/retry`, {
					method: "POST",
					headers: { origin: `http://127.0.0.1:${port}` },
				});

			expect((await retry("alpha")).status).toBe(200);
			expect((await deps.service.find("alpha")).state).toMatchObject({
				status: "working",
				mergeAttempts: 0,
			});
			expect(await (await retry("beta")).json()).toMatchObject({
				reason: "usage",
			});
			expect((await retry("nope")).status).toBe(404);
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

	describe("release", () => {
		it("says on every page when a newer arbor is out, and nothing when the check fails", async () => {
			let latest: string | null = null;
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				newest: async () => latest,
				running: "0.0.43",
				checkEvery: Duration.ms(20),
			});
			try {
				const { port } = server;
				const read = async () =>
					(
						(await (
							await fetch(`http://localhost:${port}/api/snapshot`)
						).json()) as Snapshot
					).release;
				expect(await read()).toBeNull();
				expect(
					await (await fetch(`http://localhost:${port}/api/release`)).json(),
				).toEqual({
					running: "0.0.43",
					newest: null,
					behind: null,
					interrupted: [],
				});

				const events = await fetch(`http://localhost:${port}/events`);
				const reader = events.body?.getReader();
				if (!reader) {
					throw new Error("no event stream");
				}
				await readUntil(reader, "connected");
				latest = "0.0.44";
				expect(await within(reader, "changed", 5_000)).toBe(true);
				await reader.cancel();
				expect(await read()).toEqual({ running: "0.0.43", newest: "0.0.44" });
			} finally {
				await server.disposeAsync();
			}
		});

		it("says on every page when commits land on the source it runs from, asking npm nothing", async () => {
			let commit = "a".repeat(40);
			let asked = 0;
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				newest: async () => {
					asked += 1;
					return "9.9.9";
				},
				source: async () => commit,
				sourceEvery: Duration.ms(20),
			});
			try {
				const { port } = server;
				const read = async () =>
					(await (
						await fetch(`http://localhost:${port}/api/snapshot`)
					).json()) as Snapshot;
				expect((await read()).behind).toBeNull();

				const events = await fetch(`http://localhost:${port}/events`);
				const reader = events.body?.getReader();
				if (!reader) {
					throw new Error("no event stream");
				}
				await readUntil(reader, "connected");
				commit = "b".repeat(40);
				expect(await within(reader, "changed", 5_000)).toBe(true);
				await reader.cancel();

				expect(await read()).toMatchObject({
					release: null,
					behind: { running: "a".repeat(40), newest: "b".repeat(40) },
				});
				expect(
					await (await fetch(`http://localhost:${port}/api/projects`)).json(),
				).toMatchObject({
					newest: null,
					behind: { running: "a".repeat(40), newest: "b".repeat(40) },
					restartable: false,
				});
				expect(asked).toBe(0);
			} finally {
				await server.disposeAsync();
			}
		});
	});

	describe("conversations", () => {
		let agent: FakeAgent;
		let conversations: Conversations;

		beforeEach(() => {
			agent = new FakeAgent();
			conversations = new Conversations(
				`${deps.arborDir}/conversations`,
				[AGENT],
				{
					launch: agent.launch,
				},
			);
		});

		const json = (port: number, path: string, method: string, body = {}) =>
			fetch(`http://127.0.0.1:${port}${path}`, {
				method,
				headers: {
					origin: `http://127.0.0.1:${port}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(body),
			});

		it("says they are off unless asked for", async () => {
			await serving(async (_, port) => {
				const response = await fetch(
					`http://localhost:${port}/api/conversations`,
				);

				expect(response.status).toBe(404);
				expect(await response.json()).toMatchObject({
					reason: "not_found",
					message: "conversations are off",
				});
			});
		});

		it("lists the live ones as what a restart would stop", async () => {
			let finish = () => {};
			agent.turn = () =>
				new Promise((resolve) => {
					finish = () => resolve("end_turn");
				});
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
			});
			try {
				const { port } = server;
				const started = await json(port, "/api/conversations", "POST", {
					agent: "fake",
				});
				const { id } = (await started.json()) as { id: string };
				const release = async () =>
					(
						(await (
							await fetch(`http://localhost:${port}/api/release`)
						).json()) as { interrupted: unknown[] }
					).interrupted;
				for (let i = 0; i < 100; i++) {
					const response = await json(
						port,
						`/api/conversations/${id}/prompt`,
						"POST",
						{ text: "hi" },
					);
					if (response.status === 200) {
						break;
					}
					await Bun.sleep(5);
				}

				expect(await release()).toEqual([
					{
						project: "repo",
						id,
						name: "fake",
						status: "running",
						checkpoint: null,
					},
				]);
				finish();
				const idle = {
					project: "repo",
					id,
					name: "fake",
					status: "idle",
					checkpoint: null,
				};
				for (
					let i = 0;
					i < 100 && JSON.stringify(await release()) !== JSON.stringify([idle]);
					i++
				) {
					await Bun.sleep(5);
				}
				expect(await release()).toEqual([idle]);
				await json(port, `/api/conversations/${id}/archived`, "PUT", {
					archived: true,
				});
				expect(await release()).toEqual([]);
			} finally {
				finish();
				await server.disposeAsync();
			}
		});

		it("assigns a todo and a lane an agent off the roster, and starts a conversation on a model", async () => {
			const rostered = new Conversations(
				`${deps.arborDir}/conversations`,
				[ROSTERED],
				{ launch: agent.launch },
			);
			await deps.todos.add("first", null);
			await deps.todos.addLane("Licensing");
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => rostered,
			});
			try {
				const { port } = server;
				const listed = (await (
					await fetch(`http://localhost:${port}/api/conversations`)
				).json()) as { agents: unknown[] };
				expect(listed.agents).toEqual([
					{
						id: "fake",
						name: "Fake",
						models: [
							{ id: "big", name: "Big" },
							{ id: "small", name: "Small" },
						],
						settings: [],
					},
				]);

				await json(port, "/api/todos/1/assignee", "PUT", {
					agent: "fake",
					model: "Small",
				});
				await json(port, "/api/lanes/1/assignee", "PUT", { agent: "fake" });
				expect((await deps.todos.find(1)).state.assignee).toEqual({
					agent: "fake",
					model: "small",
				});
				expect(await deps.todos.lanes()).toEqual([
					{ id: 1, name: "Licensing", assignee: { agent: "fake" } },
				]);
				const refused = await json(port, "/api/todos/1/assignee", "PUT", {
					agent: "nobody",
				});
				expect(refused.status).toBe(400);
				await json(port, "/api/todos/1/assignee", "PUT", { agent: null });
				expect((await deps.todos.find(1)).state.assignee).toBeUndefined();

				const started = await json(port, "/api/conversations", "POST", {
					agent: "fake",
					model: "small",
				});
				const { id } = (await started.json()) as { id: string };
				const conversation = await rostered.find(id);
				for (let i = 0; i < 100 && conversation.state.status !== "idle"; i++) {
					await Bun.sleep(5);
				}
				expect(agent.chosen).toEqual([{ configId: "model", value: "small" }]);
			} finally {
				await server.disposeAsync();
			}
		});

		it("starts the agent of a task handed to one, in its tree, once", async () => {
			const said: string[] = [];
			agent.turn = async (_, __, text) => {
				said.push(text);
				return "end_turn";
			};
			const until = async (done: () => boolean) => {
				for (let i = 0; i < 200 && !done(); i++) {
					await Bun.sleep(10);
				}
			};
			await add(deps, "alpha", {
				dispatch: { agent: "fake", model: "Small", prompt: "Do the part." },
				agents: [ROSTERED],
			});
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
			});
			try {
				await until(() => said.length === 1);
				const alpha = await deps.service.find("alpha");
				const [started] = await conversations.list();

				expect(said).toEqual(["[ARBOR TASK alpha]\n\nDo the part."]);
				expect(agent.launched.map((each) => each.cwd)).toEqual([alpha.path]);
				expect(agent.chosen).toEqual([{ configId: "model", value: "small" }]);
				expect(started?.state.task).toBe("alpha");
				expect(alpha.state?.dispatch?.conversation).toBe(started?.id);

				// Handed over while the server runs, with no page listening.
				await add(deps, "beta", {
					dispatch: { agent: "fake" },
					agents: [ROSTERED],
				});
				await until(() => said.length === 2);

				expect(said[1]).toBe("[ARBOR TASK beta]");
			} finally {
				await server.disposeAsync();
			}

			// Each is started once, however often the server starts, and one
			// whose tree is still readying waits for it.
			await add(deps, "gamma", {
				dispatch: { agent: "fake" },
				agents: [ROSTERED],
			});
			const gamma = await deps.service.find("gamma");
			await gamma.save({
				dispatch: { ...gamma.state?.dispatch, agent: "fake", pending: true },
			});
			const again = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
			});
			try {
				await Bun.sleep(200);
				expect(agent.launched).toHaveLength(2);
			} finally {
				await again.disposeAsync();
			}
		});

		it("lists the sessions in a task's tree and brings one in", async () => {
			await add(deps, "alpha");
			const tree = (await deps.service.find("alpha")).path;
			agent.held = [
				{
					sessionId: "cli-1",
					cwd: tree,
					title: "From the CLI",
					replay: [heard("hello"), say("Hi.")],
				},
			];
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
			});
			try {
				const { port } = server;
				const listed = await fetch(
					`http://localhost:${port}/api/conversations/sessions?task=alpha`,
				);

				expect(await listed.json()).toEqual([
					{
						agent: "fake",
						session: "cli-1",
						title: "From the CLI",
						updatedAt: null,
					},
				]);

				const brought = await json(
					port,
					"/api/conversations/sessions",
					"POST",
					{
						agent: "fake",
						session: "cli-1",
						task: "alpha",
						title: "From the CLI",
					},
				);
				expect(brought.status).toBe(200);
				const { id } = (await brought.json()) as { id: string };
				const conversation = await conversations.find(id);
				for (let i = 0; i < 100 && conversation.state.status !== "idle"; i++) {
					await Bun.sleep(5);
				}
				expect(conversation.state).toMatchObject({
					task: "alpha",
					title: "From the CLI",
					messages: [
						{ role: "user", parts: [{ type: "text", text: "hello" }] },
						{ role: "agent", parts: [{ type: "text", text: "Hi." }] },
					],
				});
				expect(agent.launched.at(-1)?.cwd).toBe(tree);
			} finally {
				await server.disposeAsync();
			}
		});

		it("checkpoints every live one, saying how each is getting on", async () => {
			const said: string[] = [];
			agent.turn = async (_, __, text) => {
				said.push(text);
				return "end_turn";
			};
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
			});
			try {
				const { port } = server;
				const started = await json(port, "/api/conversations", "POST", {
					agent: "fake",
				});
				const { id } = (await started.json()) as { id: string };
				const conversation = await conversations.find(id);
				for (let i = 0; i < 100 && conversation.state.status !== "idle"; i++) {
					await Bun.sleep(5);
				}

				const response = await json(port, "/api/release/checkpoint", "POST");

				expect(response.status).toBe(200);
				for (
					let i = 0;
					i < 100 && conversation.state.checkpoint !== "done";
					i++
				) {
					await Bun.sleep(5);
				}
				expect(said).toEqual(["[ARBOR CHECKPOINT]"]);
				expect(
					(
						(await (
							await fetch(`http://localhost:${port}/api/release`)
						).json()) as { interrupted: unknown[] }
					).interrupted,
				).toEqual([
					{
						project: "repo",
						id,
						name: "fake",
						status: "idle",
						checkpoint: "done",
					},
				]);
			} finally {
				await server.disposeAsync();
			}
		});

		it("checkpoints the live ones of each project named", async () => {
			const said: string[] = [];
			agent.turn = async (_, __, text) => {
				said.push(text);
				return "end_turn";
			};
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
			});
			try {
				const { port } = server;
				const started = await json(port, "/api/conversations", "POST", {
					agent: "fake",
				});
				const { id } = (await started.json()) as { id: string };
				const conversation = await conversations.find(id);
				for (let i = 0; i < 100 && conversation.state.status !== "idle"; i++) {
					await Bun.sleep(5);
				}

				expect((await json(port, "/api/checkpoint", "POST")).status).toBe(400);
				const response = await json(port, "/api/checkpoint", "POST", {
					projects: ["repo"],
				});

				expect(response.status).toBe(200);
				for (
					let i = 0;
					i < 100 && conversation.state.checkpoint !== "done";
					i++
				) {
					await Bun.sleep(5);
				}
				expect(said).toEqual(["[ARBOR CHECKPOINT]"]);
				await json(port, "/api/conversations/checkpoint", "DELETE");
				expect(conversation.state.checkpoint).toBeNull();
			} finally {
				await server.disposeAsync();
			}
		});

		it("lists each project's live conversations, for its checkpoint", async () => {
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
			});
			try {
				const { port } = server;
				const started = await json(port, "/api/conversations", "POST", {
					agent: "fake",
				});
				const { id } = (await started.json()) as { id: string };
				const conversation = await conversations.find(id);
				for (let i = 0; i < 100 && conversation.state.status !== "idle"; i++) {
					await Bun.sleep(5);
				}

				const listed = (await (
					await fetch(`http://127.0.0.1:${port}/api/projects`)
				).json()) as { projects: { conversations: unknown[] }[] };

				expect(listed.projects[0]?.conversations).toEqual([
					{ id, name: "fake", status: "idle", checkpoint: null },
				]);
			} finally {
				await server.disposeAsync();
			}
		});

		it("restarts once every live one has checkpointed, each waiting after to be resumed", async () => {
			const said: string[] = [];
			agent.turn = async (_, __, text) => {
				said.push(text);
				return "end_turn";
			};
			const exits: number[] = [];
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
				exit: (code) => exits.push(code),
			});
			try {
				const { port } = server;
				const started = await json(port, "/api/conversations", "POST", {
					agent: "fake",
				});
				const { id } = (await started.json()) as { id: string };
				const conversation = await conversations.find(id);
				for (let i = 0; i < 100 && conversation.state.status !== "idle"; i++) {
					await Bun.sleep(5);
				}

				const response = await json(port, "/api/checkpoint", "POST", {
					projects: ["repo"],
					after: "restart",
				});

				expect(response.status).toBe(200);
				for (let i = 0; i < 100 && exits.length === 0; i++) {
					await Bun.sleep(5);
				}
				expect(exits).toEqual([RESTART]);
				expect(said).toEqual([CHECKPOINT]);
				expect(conversation.state).toMatchObject({
					status: "stopped",
					checkpoint: "done",
				});
			} finally {
				if (exits.length === 0) {
					await server.disposeAsync();
				}
			}

			const again = new Conversations(
				`${deps.arborDir}/conversations`,
				[AGENT],
				{ launch: agent.launch },
			);
			const restarted = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => again,
			});
			try {
				await Bun.sleep(50);
				expect(said).toEqual([CHECKPOINT]);
				const listed = (await (
					await fetch(`http://127.0.0.1:${restarted.port}/api/projects`)
				).json()) as { restarted: string | null };
				expect(listed.restarted).toBe("waiting");

				await json(restarted.port, "/api/checkpoint/resume", "POST");

				for (let i = 0; i < 100 && said.length < 2; i++) {
					await Bun.sleep(5);
				}
				expect(said).toEqual([CHECKPOINT, RESUME]);
			} finally {
				await restarted.disposeAsync();
			}
		});

		it("says a restart that resumes is to follow the checkpoint, then opens each other project it stopped agents in at once, for each to carry on", async () => {
			await using other = await Testing.open();
			await deps.projects.register(deps.root);
			await deps.projects.register(other.root);
			const said: string[] = [];
			let answer = () => {};
			const answered = new Promise<void>((resolve) => {
				answer = resolve;
			});
			agent.turn = async (_, __, text) => {
				said.push(text);
				if (text === CHECKPOINT) {
					await answered;
				}
				return "end_turn";
			};
			const opened = new Map<string, Conversations>();
			const converse = ({ arborDir }: { arborDir: string }) => {
				const found =
					opened.get(arborDir) ??
					new Conversations(`${arborDir}/conversations`, [AGENT], {
						launch: agent.launch,
					});
				opened.set(arborDir, found);
				return found;
			};
			const exits: number[] = [];
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: converse,
				exit: (code) => exits.push(code),
			});
			const listed = async (port: number) =>
				(await (
					await fetch(`http://127.0.0.1:${port}/api/projects`)
				).json()) as {
					restarting: { resume: boolean } | null;
					restarted: string | null;
					run: string;
				};
			let run = "";
			try {
				const { port } = server;
				const started = await json(
					port,
					"/api/conversations?project=repo-2",
					"POST",
					{ agent: "fake" },
				);
				const { id } = (await started.json()) as { id: string };
				const conversation = await converse(other).find(id);
				for (let i = 0; i < 100 && conversation.state.status !== "idle"; i++) {
					await Bun.sleep(5);
				}
				expect((await listed(port)).restarting).toBeNull();

				await json(port, "/api/checkpoint", "POST", {
					projects: ["repo-2"],
					after: "resume",
				});

				({ run } = await listed(port));
				expect((await listed(port)).restarting).toEqual({ resume: true });
				answer();
				for (let i = 0; i < 100 && exits.length === 0; i++) {
					await Bun.sleep(5);
				}
				expect(exits).toEqual([RESTART]);
			} finally {
				if (exits.length === 0) {
					await server.disposeAsync();
				}
			}

			opened.clear();
			const restarted = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: converse,
			});
			try {
				for (let i = 0; i < 100 && said.length < 2; i++) {
					await Bun.sleep(5);
				}
				expect(said).toEqual([CHECKPOINT, RESUME]);
				const again = await listed(restarted.port);
				expect(again.run).not.toBe(run);
				expect(again.restarting).toBeNull();
				for (
					let i = 0;
					i < 100 && (await listed(restarted.port)).restarted !== null;
					i++
				) {
					await Bun.sleep(5);
				}
				expect((await listed(restarted.port)).restarted).toBeNull();
			} finally {
				await restarted.disposeAsync();
			}
		});

		it("tells each one done with a checkpoint to carry on", async () => {
			const said: string[] = [];
			agent.turn = async (_, __, text) => {
				said.push(text);
				return "end_turn";
			};
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
			});
			try {
				const { port } = server;
				const started = await json(port, "/api/conversations", "POST", {
					agent: "fake",
				});
				const { id } = (await started.json()) as { id: string };
				const conversation = await conversations.find(id);
				for (let i = 0; i < 100 && conversation.state.status !== "idle"; i++) {
					await Bun.sleep(5);
				}
				await json(port, "/api/checkpoint", "POST", { projects: ["repo"] });
				for (
					let i = 0;
					i < 100 && conversation.state.checkpoint !== "done";
					i++
				) {
					await Bun.sleep(5);
				}

				const response = await json(port, "/api/checkpoint/resume", "POST");

				expect(response.status).toBe(200);
				expect(conversation.state.checkpoint).toBeNull();
				for (let i = 0; i < 100 && said.length < 2; i++) {
					await Bun.sleep(5);
				}
				expect(said).toEqual([CHECKPOINT, RESUME]);
			} finally {
				await server.disposeAsync();
			}
		});

		it("asks only the conversations named, to retry those a checkpoint missed", async () => {
			const said: string[] = [];
			agent.turn = async (_, __, text) => {
				said.push(text);
				return "end_turn";
			};
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
			});
			try {
				const { port } = server;
				const start = async () => {
					const started = await json(port, "/api/conversations", "POST", {
						agent: "fake",
					});
					const { id } = (await started.json()) as { id: string };
					const conversation = await conversations.find(id);
					for (
						let i = 0;
						i < 100 && conversation.state.status !== "idle";
						i++
					) {
						await Bun.sleep(5);
					}
					return conversation;
				};
				const one = await start();
				const two = await start();

				await json(port, "/api/checkpoint", "POST", {
					projects: ["repo"],
					conversations: [two.id],
				});
				for (let i = 0; i < 100 && two.state.checkpoint !== "done"; i++) {
					await Bun.sleep(5);
				}

				expect(said).toEqual([CHECKPOINT]);
				expect(one.state.checkpoint).toBeNull();
			} finally {
				await server.disposeAsync();
			}
		});

		it("restarts at once with every agent idle, refused while one is at work, and reopens nothing after", async () => {
			let finish = () => {};
			agent.turn = () =>
				new Promise((resolve) => {
					finish = () => resolve("end_turn");
				});
			const exits: number[] = [];
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
				exit: (code) => exits.push(code),
			});
			try {
				const { port } = server;
				const started = await json(port, "/api/conversations", "POST", {
					agent: "fake",
				});
				const { id } = (await started.json()) as { id: string };
				const conversation = await conversations.find(id);
				for (let i = 0; i < 100 && conversation.state.status !== "idle"; i++) {
					await Bun.sleep(5);
				}
				void conversation.prompt("work");
				for (
					let i = 0;
					i < 100 && conversation.state.status !== "running";
					i++
				) {
					await Bun.sleep(5);
				}

				const refused = await json(port, "/api/restart", "POST");

				expect(refused.status).toBe(400);
				expect(await refused.json()).toMatchObject({ reason: "usage" });

				finish();
				for (let i = 0; i < 100 && conversation.state.status !== "idle"; i++) {
					await Bun.sleep(5);
				}

				const restarted = await json(port, "/api/restart", "POST");

				expect(restarted.status).toBe(200);
				for (let i = 0; i < 100 && exits.length === 0; i++) {
					await Bun.sleep(5);
				}
				expect(exits).toEqual([RESTART]);
			} finally {
				if (exits.length === 0) {
					await server.disposeAsync();
				}
			}

			const again = await dev(deps, { ports: OpenPortProvider.any() });
			try {
				const listed = (await (
					await fetch(`http://127.0.0.1:${again.port}/api/projects`)
				).json()) as { restarted: string | null };
				expect(listed.restarted).toBeNull();
			} finally {
				await again.disposeAsync();
			}
		});

		it("restarts once a checkpoint has ended, each one done with it waiting after to be resumed", async () => {
			const said: string[] = [];
			agent.turn = async (_, __, text) => {
				said.push(text);
				return "end_turn";
			};
			const exits: number[] = [];
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
				exit: (code) => exits.push(code),
			});
			try {
				const { port } = server;
				const started = await json(port, "/api/conversations", "POST", {
					agent: "fake",
				});
				const { id } = (await started.json()) as { id: string };
				const conversation = await conversations.find(id);
				for (let i = 0; i < 100 && conversation.state.status !== "idle"; i++) {
					await Bun.sleep(5);
				}
				await json(port, "/api/checkpoint", "POST", { projects: ["repo"] });
				for (
					let i = 0;
					i < 100 && conversation.state.checkpoint !== "done";
					i++
				) {
					await Bun.sleep(5);
				}

				const response = await json(port, "/api/checkpoint/restart", "POST");

				expect(response.status).toBe(200);
				for (let i = 0; i < 100 && exits.length === 0; i++) {
					await Bun.sleep(5);
				}
				expect(exits).toEqual([RESTART]);
			} finally {
				if (exits.length === 0) {
					await server.disposeAsync();
				}
			}

			const again = new Conversations(
				`${deps.arborDir}/conversations`,
				[AGENT],
				{ launch: agent.launch },
			);
			const restarted = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => again,
			});
			try {
				await Bun.sleep(50);
				expect(said).toEqual([CHECKPOINT]);
				const listed = (await (
					await fetch(`http://127.0.0.1:${restarted.port}/api/projects`)
				).json()) as { restarted: string | null };
				expect(listed.restarted).toBe("waiting");

				await json(restarted.port, "/api/checkpoint/resume", "POST");

				for (let i = 0; i < 100 && said.length < 2; i++) {
					await Bun.sleep(5);
				}
				expect(said).toEqual([CHECKPOINT, RESUME]);
			} finally {
				await restarted.disposeAsync();
			}
		});

		it("asks no one again while a checkpoint is under way", async () => {
			const said: string[] = [];
			agent.turn = (_, __, text) => {
				said.push(text);
				return new Promise(() => {});
			};
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
			});
			try {
				const { port } = server;
				const started = await json(port, "/api/conversations", "POST", {
					agent: "fake",
				});
				const { id } = (await started.json()) as { id: string };
				const conversation = await conversations.find(id);
				for (let i = 0; i < 100 && conversation.state.status !== "idle"; i++) {
					await Bun.sleep(5);
				}

				await json(port, "/api/checkpoint", "POST", { projects: ["repo"] });
				for (let i = 0; i < 100 && said.length === 0; i++) {
					await Bun.sleep(5);
				}
				await json(port, "/api/checkpoint", "POST", { projects: ["repo"] });
				await Bun.sleep(20);

				expect(agent.cancelled).toBe(0);
				expect(said).toEqual(["[ARBOR CHECKPOINT]"]);
				expect(conversation.state.checkpoint).toBe("asked");
			} finally {
				await server.disposeAsync();
			}
		});

		it("starts one in a task's tree, streams the agent's turn, and archives it", async () => {
			await add(deps, "alpha");
			agent.turn = async (client, sessionId) => {
				await client.sessionUpdate({ sessionId, update: say("Hello ") });
				await client.sessionUpdate({ sessionId, update: say("there.") });
				return "end_turn";
			};
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
			});
			try {
				const { port } = server;
				const listed = await (
					await fetch(`http://localhost:${port}/api/conversations`)
				).json();
				expect(listed).toEqual({
					agents: [{ id: "fake", name: "Fake", models: [], settings: [] }],
					conversations: [],
				});

				const started = await json(port, "/api/conversations", "POST", {
					agent: "fake",
					task: "alpha",
				});
				const { id } = (await started.json()) as { id: string };
				expect(agent.launched).toEqual([
					{
						argv: ["fake-acp"],
						cwd: (await deps.service.find("alpha")).path,
						env: {
							ARBOR_CONVERSATION: id,
							ARBOR_DEV: `http://localhost:${port}`,
						},
					},
				]);
				const events = await fetch(
					`http://localhost:${port}/api/conversations/events`,
				);
				const reader = events.body?.getReader();
				if (!reader) {
					throw new Error("no event stream");
				}
				for (let i = 0; i < 100; i++) {
					const response = await json(
						port,
						`/api/conversations/${id}/prompt`,
						"POST",
						{
							text: "hi",
						},
					);
					if (response.status === 200) {
						break;
					}
					// Still starting: the agent has yet to open its session.
					await Bun.sleep(5);
				}

				expect(await readUntil(reader, "Hello there.")).toContain(
					'"role":"agent"',
				);
				await reader.cancel();
				const archived = await json(
					port,
					`/api/conversations/${id}/archived`,
					"PUT",
					{ archived: true },
				);
				expect(await archived.json()).toMatchObject({
					id,
					status: "stopped",
					archived: true,
				});
				expect(agent.killed).toBe(1);
			} finally {
				await server.disposeAsync();
			}
		}, 15_000);

		it("refuses a conversation in a task with no worktree", async () => {
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
			});
			try {
				const response = await json(server.port, "/api/conversations", "POST", {
					agent: "fake",
					task: "nope",
				});

				expect(response.status).toBe(404);
				expect(agent.launched).toEqual([]);
			} finally {
				await server.disposeAsync();
			}
		});

		it("answers only to this machine, even for a host the board lets in", async () => {
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				hosts: ["repo.arbor.example"],
				conversations: () => conversations,
			});
			try {
				const as = (host: string, path: string) =>
					fetch(`http://127.0.0.1:${server.port}${path}`, {
						headers: { host },
					});

				expect((await as("repo.arbor.example", "/api/snapshot")).status).toBe(
					200,
				);
				const refused = await as("repo.arbor.example", "/api/conversations");
				expect(refused.status).toBe(403);
				expect(await refused.json()).toMatchObject({
					message:
						"conversations and terminals run commands on this machine: open the page on it",
				});
				expect(
					(await as(`localhost:${server.port}`, "/api/conversations")).status,
				).toBe(200);
			} finally {
				await server.disposeAsync();
			}
		});

		it("refuses a start from another site", async () => {
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
			});
			try {
				const response = await fetch(
					`http://127.0.0.1:${server.port}/api/conversations`,
					{
						method: "POST",
						headers: { origin: "https://evil.example" },
						body: JSON.stringify({ agent: "fake" }),
					},
				);

				expect(response.status).toBe(403);
				expect(agent.launched).toEqual([]);
			} finally {
				await server.disposeAsync();
			}
		});
	});

	describe("terminal", () => {
		/** Asks for a terminal the way a browser would, and says how it went. */
		const knock = (port: number, headers: Record<string, string>, query = "") =>
			fetch(`http://127.0.0.1:${port}/api/terminal${query}`, {
				headers: {
					connection: "Upgrade",
					upgrade: "websocket",
					"sec-websocket-version": "13",
					"sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
					origin: `http://127.0.0.1:${port}`,
					...headers,
				},
			});

		/** A terminal open on `query`, with everything it has said so far. */
		const terminal = async (port: number, query = "") => {
			// As a page would: Bun's client sends no Origin of its own. The DOM's
			// type for the constructor does not know Bun takes options here.
			const options: Bun.WebSocketOptions = {
				headers: { origin: `http://127.0.0.1:${port}` },
			};
			const socket = new WebSocket(
				`ws://127.0.0.1:${port}/api/terminal${query}`,
				options as string[],
			);
			socket.binaryType = "arraybuffer";
			const said = { screen: "", controls: [] as unknown[], closed: false };
			const decoder = new TextDecoder();
			socket.addEventListener("message", ({ data }) => {
				if (typeof data === "string") {
					said.controls.push(JSON.parse(data));
				} else {
					said.screen += decoder.decode(data as ArrayBuffer, { stream: true });
				}
			});
			socket.addEventListener("close", () => {
				said.closed = true;
			});
			await new Promise((resolve, reject) => {
				socket.addEventListener("open", resolve);
				socket.addEventListener("error", reject);
			});
			/** Waits for the shell to have written `text`, up to a few seconds. */
			const shows = async (text: string) => {
				for (let i = 0; i < 300 && !said.screen.includes(text); i++) {
					await Bun.sleep(10);
				}
				expect(said.screen).toContain(text);
			};
			return { socket, said, shows };
		};

		const opened = async (
			body: (port: number) => Promise<void>,
			options: { hosts?: string[] } = {},
		) => {
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				shell: ["/bin/sh"],
				...options,
			});
			try {
				await body(server.port);
			} finally {
				await server.disposeAsync();
			}
		};

		it("says it is off unless asked for", async () => {
			await serving(async (_, port) => {
				const response = await knock(port, {});

				expect(response.status).toBe(404);
				expect(await response.json()).toMatchObject({
					message: "terminals are off",
				});
			});
		});

		it("runs a shell in the main tree", async () => {
			await opened(async (port) => {
				const { socket, shows } = await terminal(port);

				socket.send(new TextEncoder().encode("echo at:$(pwd)\n"));

				await shows(`at:${deps.service.git.root}`);
			});
		});

		it("runs a shell in a task's worktree", async () => {
			await add(deps, "alpha");
			const alpha = (await deps.service.find("alpha")).path;
			await opened(async (port) => {
				const { socket, shows } = await terminal(port, "?task=alpha");

				socket.send(new TextEncoder().encode("echo at:$(pwd)\n"));

				await shows(`at:${alpha}`);
			});
		});

		it("starts at the size asked for, and follows a resize", async () => {
			await opened(async (port) => {
				const { socket, shows } = await terminal(port, "?cols=100&rows=30");
				socket.send(new TextEncoder().encode("stty size\n"));
				await shows("30 100");

				socket.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
				socket.send(new TextEncoder().encode("stty size\n"));

				await shows("40 120");
			});
		});

		it("says how the shell exited, then closes", async () => {
			await opened(async (port) => {
				const { socket, said } = await terminal(port);

				socket.send(new TextEncoder().encode("exit 3\n"));

				for (let i = 0; i < 300 && !said.closed; i++) {
					await Bun.sleep(10);
				}
				expect(said).toMatchObject({
					controls: [{ type: "exit", code: 3 }],
					closed: true,
				});
			});
		});

		it("refuses one in a task with no worktree", async () => {
			await opened(async (port) => {
				const response = await knock(port, {}, "?task=nope");

				expect(response.status).toBe(404);
			});
		});

		it("refuses one opened from another site", async () => {
			await opened(async (port) => {
				const response = await knock(port, { origin: "https://evil.example" });

				expect(response.status).toBe(403);
				expect(await response.json()).toMatchObject({
					message: "a terminal opens only from its own page",
				});
			});
		});

		it("refuses one with an origin that is not one", async () => {
			await opened(async (port) => {
				const response = await knock(port, { origin: "" });

				expect(response.status).toBe(403);
			});
		});

		it("answers only to this machine, even for a host the board lets in", async () => {
			await opened(
				async (port) => {
					const response = await knock(port, {
						host: "repo.arbor.example",
						origin: "http://repo.arbor.example",
					});

					expect(response.status).toBe(403);
					expect(await response.json()).toMatchObject({
						message:
							"conversations and terminals run commands on this machine: open the page on it",
					});
				},
				{ hosts: ["repo.arbor.example"] },
			);
		});
	});
});
