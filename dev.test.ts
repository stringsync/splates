import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { add } from "./add";
import type { Config } from "./config";
import { dev } from "./dev";
import { Git } from "./git";
import { Journal } from "./journal";
import { Shell } from "./shell";
import type { Snapshot } from "./snapshot";
import { repo, testConfig } from "./testing";
import { WorktreeService } from "./worktree-service";

describe("dev", () => {
	let deps: Awaited<ReturnType<typeof repo>> & {
		config: Config;
		service: WorktreeService;
		shell: Shell;
		journal: Journal;
	};

	beforeEach(async () => {
		const fixture = await repo();
		const config = testConfig(fixture.root);
		const service = new WorktreeService(
			new Git(fixture.root, { ps: fixture.ps, fs: fixture.fs }),
			config,
			fixture.arborDir,
			{ fs: fixture.fs, ps: fixture.ps },
		);
		await service.init();
		deps = {
			...fixture,
			config,
			service,
			shell: new Shell({ ps: fixture.ps }),
			journal: new Journal(
				`${fixture.arborDir}/log.jsonl`,
				config.logCapacity,
				{ fs: fixture.fs },
			),
		};
	});

	afterEach(() => deps.cleanup());

	/** Port 0 so concurrent test files cannot collide on a fixed one. */
	const serving = async (
		body: (snapshot: () => Promise<Snapshot>, port: number) => Promise<void>,
	): Promise<void> => {
		const server = await dev(deps, { port: 0 });
		try {
			await body(
				async () =>
					(await (
						await fetch(`http://localhost:${server.port}/api/snapshot`)
					).json()) as Snapshot,
				server.port,
			);
		} finally {
			await server.stop();
		}
	};

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

	// The `/main.js` route is deliberately not asserted here. `BunBundler` cannot
	// resolve the extensionless imports in `@webappwiz/react`'s entry point when
	// it runs under `bun test`, though the identical build succeeds outside it, so
	// a test of that route would fail on a Bun quirk rather than on this code.
	// What the bundle needs is that the page's modules typecheck and resolve,
	// which `bin/wiz fix` covers by running tsc over the workspace.
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
			expect(css).toContain("color-scheme: light dark");
			// Real utilities, not just the theme block: Tailwind emits only the
			// classes it can see, and it compiles happily to nothing at all when it
			// is pointed at no sources. One class from the page and one from the
			// `Markdown` component beside it, since they are found by
			// separate `@source` lines.
			expect(css).toContain("max-w-6xl");
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
			let sse = "";
			while (!sse.includes("data: changed")) {
				const { value, done } = await reader.read();
				if (done) {
					break;
				}
				sse += new TextDecoder().decode(value);
			}

			expect(sse).toContain("data: changed");
			await reader.cancel();
		});
	}, 15_000);
});
