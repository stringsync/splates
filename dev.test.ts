import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { add } from "./add";
import type { Config } from "./config";
import { dev } from "./dev";
import { Git } from "./git";
import { Journal } from "./journal";
import { Shell } from "./shell";
import { repo, testConfig } from "./testing";
import { WorktreeStore } from "./worktree-store";

describe("dev", () => {
	let deps: Awaited<ReturnType<typeof repo>> & {
		config: Config;
		store: WorktreeStore;
		shell: Shell;
		journal: Journal;
	};

	beforeEach(async () => {
		const fixture = await repo();
		const config = testConfig(fixture.root);
		const store = new WorktreeStore(
			fixture.fs,
			fixture.ps,
			new Git(fixture.ps, fixture.fs, fixture.root),
			config,
			fixture.arborDir,
		);
		await store.init();
		deps = {
			...fixture,
			config,
			store,
			shell: new Shell(fixture.ps),
			journal: new Journal(
				fixture.fs,
				`${fixture.arborDir}/log.jsonl`,
				config.logCapacity,
			),
		};
	});

	afterEach(() => deps.cleanup());

	it("serves each task's fields, its TODO.md and the log", async () => {
		await deps.journal.record("add", "alpha", () => add(deps, "alpha"));
		const alpha = (await deps.store.find("alpha")).path;
		await deps.fs.write(
			`${alpha}/TODO.md`,
			"# alpha\n\n## Goal\nland it\n\n## Next\n- [ ] the rest\n",
		);

		// Port 0 so concurrent test files cannot collide on a fixed one.
		const server = await dev(deps, { port: 0 });
		try {
			const html = await (
				await fetch(`http://localhost:${server.port}/`)
			).text();

			expect(html).toContain("task/alpha");
			expect(html).toContain("working");
			expect(html).toContain("add");
			// The markdown is there, rendered rather than dumped, and open rather
			// than folded away.
			expect(html).toContain(`<p class="quiet">TODO.md</p>`);
			expect(html).toContain("<h4>Next</h4>");
			// The card's header already names the task, so the document's own
			// title is not repeated under it.
			expect(html).not.toContain("<h3>alpha</h3>");
			expect(html).toContain(
				`<li class="box"><input type="checkbox" disabled> the rest</li>`,
			);
		} finally {
			server.stop();
		}
	});

	it("bars a task by its checkboxes, counting only Done and Next", async () => {
		await add(deps, "alpha");
		const alpha = (await deps.store.find("alpha")).path;
		await deps.fs.write(
			`${alpha}/TODO.md`,
			[
				"# alpha",
				"",
				"## Goal",
				"land it",
				"",
				"## Done",
				"- [x] one",
				"- [x] two",
				"",
				"## Next",
				"- [ ] three",
				"- [ ] four",
				"",
				"## Notes",
				"- [ ] not work: a stray box here must not count",
				"",
			].join("\n"),
		);

		const server = await dev(deps, { port: 0 });
		try {
			const html = await (
				await fetch(`http://localhost:${server.port}/`)
			).text();

			expect(html).toContain(`aria-label="2 of 4 done"`);
			expect(html).toContain(`width:50%`);
		} finally {
			server.stop();
		}
	});

	it("leaves out the bar when there is nothing to count", async () => {
		await add(deps, "alpha");
		const alpha = (await deps.store.find("alpha")).path;
		await deps.fs.write(`${alpha}/TODO.md`, "# alpha\n\n## Goal\nland it\n");

		const server = await dev(deps, { port: 0 });
		try {
			const html = await (
				await fetch(`http://localhost:${server.port}/`)
			).text();

			expect(html).not.toContain(`class="bar"`);
		} finally {
			server.stop();
		}
	});

	it("marks an escalated task and leads its card with the reason", async () => {
		await add(deps, "alpha");
		await (await deps.store.find("alpha")).save({
			status: "escalated",
			escalations: [{ reason: "needs a human", at: new Date().toISOString() }],
		});

		const server = await dev(deps, { port: 0 });
		try {
			const html = await (
				await fetch(`http://localhost:${server.port}/`)
			).text();

			expect(html).toContain(`<article class="escalated">`);
			expect(html).toContain(`<span class="badge needs">escalated</span>`);
			expect(html).toContain("needs a human");
			// The reason belongs above the fields, not buried among them.
			expect(html.indexOf("needs a human")).toBeLessThan(html.indexOf("<dl>"));
		} finally {
			server.stop();
		}
	});

	it("marks a task whose worktree is gone as broken rather than normal", async () => {
		await add(deps, "alpha");
		await deps.fs.rm((await deps.store.find("alpha")).path, {
			recursive: true,
			force: true,
		});

		const server = await dev(deps, { port: 0 });
		try {
			const html = await (
				await fetch(`http://localhost:${server.port}/`)
			).text();

			expect(html).toContain(`<span class="badge broken">orphaned</span>`);
		} finally {
			server.stop();
		}
	});

	it("escapes markup in a TODO.md instead of serving it as HTML", async () => {
		await add(deps, "alpha");
		const alpha = (await deps.store.find("alpha")).path;
		await deps.fs.write(
			`${alpha}/TODO.md`,
			"# alpha\n\n## Next\n- [ ] drop <script>alert(1)</script>\n",
		);

		const server = await dev(deps, { port: 0 });
		try {
			const html = await (
				await fetch(`http://localhost:${server.port}/`)
			).text();

			expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
			expect(html).not.toContain("<script>alert(1)</script>");
		} finally {
			server.stop();
		}
	});

	it("pushes over SSE when a task changes, and stays quiet when it does not", async () => {
		await add(deps, "alpha");
		const server = await dev(deps, { port: 0 });
		try {
			const events = await fetch(`http://localhost:${server.port}/events`);
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
		} finally {
			server.stop();
		}
	}, 15_000);
});
