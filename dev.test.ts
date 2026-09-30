import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { add } from "./add";
import { dev, devPorts } from "./dev";
import { claimReplies } from "./reply";
import type { Snapshot } from "./snapshot";
import { LIVE_PID, Testing } from "./testing";

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
			const { tasks, entries } = await snapshot();

			expect(tasks).toHaveLength(1);
			expect(tasks[0]?.task).toBe("alpha");
			expect(tasks[0]?.branch).toBe("task/alpha");
			expect(tasks[0]?.status).toBe("working");
			expect(tasks[0]?.plan).toContain("- [ ] the rest");
			expect(entries.map((entry) => entry.action)).toContain("add");
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
			expect(js).toContain("createRoot");
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
			expect(css).toContain("max-w-2xl");
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

	describe("writes", () => {
		const PLAN = [
			"# alpha",
			"",
			"## Blocked",
			"",
			"- [ ] Q1. Open the page. Does it fit?",
			"  ![the page](SHOT)",
			"",
		].join("\n");

		const asked = async (): Promise<string> => {
			await add(deps, "alpha");
			const tree = (await deps.service.find("alpha")).path;
			const path = `${tree}/ARBOR.md`;
			await deps.fs.write(path, PLAN.replace("SHOT", `${tree}/page.png`));
			return path;
		};

		/** A post the way the page makes one: same origin as the host it asked. */
		const post = (port: number, path: string, body: BodyInit, headers = {}) =>
			fetch(`http://127.0.0.1:${port}${path}`, {
				method: "POST",
				headers: { origin: `http://127.0.0.1:${port}`, ...headers },
				body,
			});

		/** A reply the way the page sends one. */
		const answer = (port: number, text: string, files: File[] = []) => {
			const form = new FormData();
			form.set("task", "alpha");
			form.set("question", "Q1");
			form.set("text", text);
			for (const file of files) {
				form.append("file", file);
			}
			return post(port, "/api/reply", form);
		};

		/** A JSON post naming Q1 on alpha, as hold, release and unreply take. */
		const named = (port: number, path: string) =>
			post(port, path, JSON.stringify({ task: "alpha", question: "Q1" }), {
				"content-type": "application/json",
			});

		it("replies to a question, files and all, and moves it to replied", async () => {
			const plan = await asked();
			const before = await deps.fs.read(plan);

			await serving(async (snapshot, port) => {
				const response = await answer(port, "it clips", [
					new File([new Uint8Array([1, 2])], "shot.png"),
					new File(["trace"], "trace.log"),
				]);

				expect(response.status).toBe(200);
				// Waiting for its agent, so the plan is as it was.
				expect(await deps.fs.read(plan)).toBe(before);
				const [question] = (await snapshot()).inbox.questions;
				expect(question).toMatchObject({
					state: "replied",
					pending: { text: "it clips" },
				});
				expect(question?.pending?.files[1]).toEndWith("-trace.log");
				const [last] = await deps.journal.tail(1);
				expect(last?.action).toBe("reply");
			});
		});

		it("refuses a reply to a tree a live agent holds, with the CLI's reason", async () => {
			await asked();
			await (await deps.service.find("alpha")).save({
				lease: {
					pid: LIVE_PID,
					hostname: deps.ps.hostname,
					heartbeatAt: new Date().toISOString(),
				},
			});

			await serving(async (_snapshot, port) => {
				const response = await answer(port, "pass");

				expect(response.status).toBe(409);
				expect(((await response.json()) as { reason: string }).reason).toBe(
					"lease_held",
				);
			});
		});

		it("holds a reply open for editing, and lets go", async () => {
			await asked();

			await serving(async (snapshot, port) => {
				expect((await named(port, "/api/reply/hold")).status).toBe(404);
				await answer(port, "no");

				expect((await named(port, "/api/reply/hold")).status).toBe(200);
				expect((await snapshot()).inbox.questions[0]?.state).toBe("editing");

				expect((await named(port, "/api/reply/release")).status).toBe(200);
				expect((await snapshot()).inbox.questions[0]?.state).toBe("replied");
			});
		});

		it("refuses to change a reply its agent has claimed", async () => {
			const plan = await asked();

			await serving(async (snapshot, port) => {
				await answer(port, "no");
				await claimReplies(deps, "alpha");

				expect(await deps.fs.read(plan)).toContain("Does it fit? → no");
				expect((await snapshot()).inbox.questions[0]?.state).toBe("read");
				for (const refused of [
					await answer(port, "yes"),
					await named(port, "/api/reply/hold"),
					await named(port, "/api/unreply"),
				]) {
					expect(refused.status).toBe(409);
				}
			});
		});

		it("serves an image an open question shows, a stored file, and nothing else", async () => {
			await asked();
			const tree = (await deps.service.find("alpha")).path;
			await deps.fs.writeBytes(`${tree}/page.png`, new Uint8Array([7]));
			await deps.fs.writeBytes(`${tree}/other.png`, new Uint8Array([8]));
			const todo = await deps.todos.add("look", null, [
				{ name: "trace.log", bytes: new Uint8Array([9]) },
			]);

			await serving(async (_snapshot, port) => {
				const file = (task: string, path: string) =>
					fetch(
						`http://127.0.0.1:${port}/api/file?${new URLSearchParams({ task, path })}`,
					);

				const shown = await file("alpha", `${tree}/page.png`);
				expect(shown.status).toBe(200);
				expect(shown.headers.get("content-type")).toBe("image/png");
				expect(new Uint8Array(await shown.arrayBuffer())).toEqual(
					new Uint8Array([7]),
				);
				expect((await file("alpha", `${tree}/other.png`)).status).toBe(404);
				expect((await file("beta", `${tree}/page.png`)).status).toBe(404);

				const stored = await file("", todo.files[0] ?? "");
				expect(stored.status).toBe(200);
				expect(stored.headers.get("content-disposition")).toBe("attachment");
				expect(
					(await file("", `${deps.todos.dir}/1/../../../config`)).status,
				).toBe(404);
			});
		});

		it("takes a reply back", async () => {
			await asked();

			await serving(async (snapshot, port) => {
				await answer(port, "no");

				expect((await named(port, "/api/unreply")).status).toBe(200);
				expect((await snapshot()).inbox.questions[0]).toMatchObject({
					state: "open",
					pending: null,
				});
				expect((await named(port, "/api/unreply")).status).toBe(404);
			});
		});

		/** A todo write the way the page makes one. */
		const todoForm = (
			text: string | null,
			files: File[] = [],
			keep: string[] = [],
		) => {
			const form = new FormData();
			if (text !== null) {
				form.set("text", text);
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
				const response = await post(
					port,
					"/api/todos",
					todoForm("write the docs", [new File(["x"], "notes.md")]),
				);

				expect(response.status).toBe(200);
				const [todo] = (await snapshot()).todos;
				expect(todo?.text).toBe("write the docs");
				expect(todo?.files[0]).toEndWith("-notes.md");
			});
		});

		it("updates and removes a todo", async () => {
			const todo = await deps.todos.add("write docs", null, [
				{ name: "a.png", bytes: new Uint8Array([1]) },
				{ name: "b.png", bytes: new Uint8Array([2]) },
			]);
			const [kept, dropped] = todo.files;

			await serving(async (snapshot, port) => {
				const write = (method: string, path: string, body?: FormData) =>
					fetch(`http://127.0.0.1:${port}${path}`, {
						method,
						headers: { origin: `http://127.0.0.1:${port}` },
						body,
					});

				const updated = await write(
					"PATCH",
					"/api/todos/1",
					todoForm("write the docs", [], [kept ?? ""]),
				);
				expect(updated.status).toBe(200);
				expect((await snapshot()).todos[0]).toMatchObject({
					text: "write the docs",
					files: [kept],
				});
				expect(await deps.fs.exists(dropped ?? "")).toBe(false);

				expect((await write("DELETE", "/api/todos/1")).status).toBe(200);
				expect((await snapshot()).todos).toEqual([]);
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
