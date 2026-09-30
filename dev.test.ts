import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { add } from "./add";
import { dev, devPorts } from "./dev";
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
			"- [ ] Q1. [ui] Open the page. Does it fit?",
			"",
		].join("\n");

		const asked = async (): Promise<string> => {
			await add(deps, "alpha");
			const path = `${(await deps.service.find("alpha")).path}/ARBOR.md`;
			await deps.fs.write(path, PLAN);
			return path;
		};

		/** A post the way the page makes one: same origin as the host it asked. */
		const post = (port: number, path: string, body: BodyInit, headers = {}) =>
			fetch(`http://127.0.0.1:${port}${path}`, {
				method: "POST",
				headers: { origin: `http://127.0.0.1:${port}`, ...headers },
				body,
			});

		it("replies to a question, image and all, and says so in the inbox", async () => {
			const plan = await asked();

			await serving(async (snapshot, port) => {
				const form = new FormData();
				form.set("task", "alpha");
				form.set("question", "Q1");
				form.set("text", "fail: it clips");
				form.append("images", new File([new Uint8Array([1, 2])], "shot.png"));

				const response = await post(port, "/api/reply", form);

				expect(response.status).toBe(200);
				const written = await deps.fs.read(plan);
				expect(written).toContain("→ fail: it clips");
				expect(written).toContain(deps.service.attachmentsPath("alpha"));
				expect((await snapshot()).inbox.questions[0]?.reply).toContain(
					"fail: it clips",
				);
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
				const form = new FormData();
				form.set("task", "alpha");
				form.set("question", "Q1");
				form.set("text", "pass");

				const response = await post(port, "/api/reply", form);

				expect(response.status).toBe(409);
				expect(((await response.json()) as { reason: string }).reason).toBe(
					"lease_held",
				);
			});
		});

		it("adds a todo", async () => {
			await serving(async (snapshot, port) => {
				const response = await post(
					port,
					"/api/todos",
					JSON.stringify({ text: "write the docs" }),
					{ "content-type": "application/json" },
				);

				expect(response.status).toBe(200);
				expect((await snapshot()).todos.map((todo) => todo.text)).toEqual([
					"write the docs",
				]);
			});
		});

		it("refuses a write from another site", async () => {
			await serving(async (_snapshot, port) => {
				const response = await post(
					port,
					"/api/todos",
					JSON.stringify({ text: "planted" }),
					{ origin: "https://evil.example" },
				);

				expect(response.status).toBe(403);
				expect(await deps.todos.all()).toEqual([]);
			});
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
