import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { add } from "./add";
import { dev, devPorts } from "./dev";
import { post, readUntil, serving, todoForm } from "./dev-testing";
import { Testing } from "./testing";
import { WorktreeService } from "./worktree-service";

describe("dev", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("refuses every request once a newer arbor has moved the records on", async () => {
		await serving(deps, async (snapshot, port) => {
			expect((await snapshot()).tasks).toEqual([]);
			await deps.fs.write(`${deps.arborDir}/format`, "2\n");

			const response = await fetch(`http://localhost:${port}/api/snapshot`);

			expect(response.status).toBe(409);
			expect(await response.text()).toContain("bunx @webappwiz/arbor@latest");
		});
	});

	it("reads the repo only while a page listens", async () => {
		const reads = new CountingService(deps);
		const home = Object.assign(
			Object.create(Object.getPrototypeOf(deps)),
			deps,
			{
				service: reads,
			},
		) as Testing;

		await serving(home, async (_, port) => {
			// Long past the settle a change waits out before the read it starts.
			const opened = reads.count;
			await Bun.sleep(250);
			expect(reads.count).toBe(opened);

			const next = reads.nextRead();
			const events = await fetch(`http://localhost:${port}/events`);
			const reader = events.body?.getReader();
			await next;
			await reader?.cancel();
		});
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

		await serving(deps, async (snapshot) => {
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

		await serving(deps, async (snapshot) => {
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

		await serving(deps, async (snapshot) => {
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

		await serving(deps, async (snapshot) => {
			// The server is a data source now: escaping is React's job, and a
			// server that pre-escaped would double-escape once it got there.
			expect((await snapshot()).tasks[0]?.plan).toContain(
				"<script>alert(1)</script>",
			);
		});
	});

	it("serves the page the browser asks for its assets from", async () => {
		await add(deps, "alpha");

		await serving(deps, async (_snapshot, port) => {
			const html = await (await fetch(`http://localhost:${port}/`)).text();

			expect(html).toContain("<title>arbor</title>");
			expect(html).toContain(`<div id="root">`);
			expect(html).toMatch(/href="\/styles\.css\?v=\w+"/);
			expect(html).toMatch(/src="\/main\.js\?v=\w+"/);
		});
	});

	it("serves a manifest and icons the page can be installed as an app with", async () => {
		await add(deps, "alpha");

		await serving(deps, async (_snapshot, port) => {
			const at = `http://localhost:${port}`;
			const html = await (await fetch(`${at}/`)).text();
			// Without credentials, Cloudflare Access would turn the manifest away.
			expect(html).toContain(
				`<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials" />`,
			);

			const response = await fetch(`${at}/manifest.webmanifest`);
			expect(response.headers.get("content-type")).toContain(
				"application/manifest+json",
			);
			const manifest = await response.json();
			expect(manifest.display).toBe("standalone");
			expect(manifest.start_url).toBe("/");
			// What each icon turns out to be: a PNG, by its signature, as wide as
			// the manifest says, by the width in its IHDR chunk.
			const served = await Promise.all(
				manifest.icons.map(async ({ src }: { src: string }) => {
					const icon = await fetch(`${at}${src}`);
					const bytes = new Uint8Array(await icon.arrayBuffer());
					const width = new DataView(bytes.buffer).getUint32(16);
					return {
						type: icon.headers.get("content-type"),
						png: new TextDecoder().decode(bytes.slice(1, 4)) === "PNG",
						sizes: `${width}x${width}`,
					};
				}),
			);
			expect(served).toEqual(
				manifest.icons.map(({ sizes }: { sizes: string }) => ({
					type: "image/png",
					png: true,
					sizes,
				})),
			);
		});
	});

	it("answers a path it does not serve with a 404", async () => {
		await add(deps, "alpha");

		await serving(deps, async (_snapshot, port) => {
			const response = await fetch(`http://localhost:${port}/nope`);

			expect(response.status).toBe(404);
		});
	});

	it("serves the React app already bundled, with nothing left to fetch", async () => {
		await add(deps, "alpha");

		await serving(deps, async (_snapshot, port) => {
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

		await serving(deps, async (_snapshot, port) => {
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

		await serving(deps, async (_snapshot, port) => {
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

	it("refuses a write from another site", async () => {
		await serving(deps, async (_snapshot, port) => {
			const response = await post(port, "/api/todos", todoForm("planted"), {
				origin: "https://evil.example",
			});

			expect(response.status).toBe(403);
			expect(await deps.todos.all()).toEqual([]);
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
			const signedIn = await fetch(
				`http://127.0.0.1:${server.port}/api/identity`,
			);
			expect(await signedIn.json()).toEqual({ email: null });
		} finally {
			await server.disposeAsync();
		}
	});
});

/** The test repo's worktrees, counting each read and telling who waits for one. */
class CountingService extends WorktreeService {
	count = 0;
	private waiting: (() => void)[] = [];

	constructor(from: Testing) {
		super(from.git, from.config, from.arborDir, {
			fs: from.fs,
			ps: from.ps,
		});
	}

	/** Settles at the next read. */
	nextRead(): Promise<void> {
		return new Promise((resolve) => this.waiting.push(resolve));
	}

	override async list(...args: Parameters<WorktreeService["list"]>) {
		this.count += 1;
		for (const resolve of this.waiting.splice(0)) {
			resolve();
		}
		return super.list(...args);
	}
}
