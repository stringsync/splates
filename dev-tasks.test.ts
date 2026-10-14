import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { add } from "./add";
import { serving } from "./dev-testing";
import type { FileDiff } from "./diff";
import type { SystemsReport } from "./system-changes";
import { Testing } from "./testing";

describe("dev tasks", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

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

		await serving(deps, async (_snapshot, port) => {
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

		await serving(deps, async (_snapshot, port) => {
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

	it("lists the paths a task's tree holds, for pointing an agent at one", async () => {
		await add(deps, "alpha");
		const tree = (await deps.service.find("alpha")).path;
		await deps.fs.mkdir(`${tree}/src/lib`);
		await deps.commit(tree, "src/lib/a.ts", "a\n", "add a");
		await deps.fs.write(`${tree}/src/new.ts`, "new\n");
		await deps.fs.write(`${tree}/.gitignore`, "*.log\n");
		await deps.fs.write(`${tree}/debug.log`, "noise\n");

		await serving(deps, async (_snapshot, port) => {
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

	it("serves each system's files on trunk and the commits that changed it", async () => {
		const root = deps.service.git.root;
		await deps.commit(
			root,
			"arbor.systems.ts",
			`export default ${JSON.stringify({
				docs: { globs: ["docs/**", "guides/**"] },
				src: { globs: ["src/**"], ignore: ["src/*.test.ts"] },
			})};\n`,
			"name the systems",
		);
		await deps.fs.mkdir(`${root}/docs`);
		await deps.fs.mkdir(`${root}/src`);
		await deps.commit(root, "docs/a.md", "a\n", "write a");
		await deps.commit(root, "src/a.ts", "a\n", "add a");
		await deps.commit(root, "src/a.test.ts", "a\n", "test a");
		await deps.commit(root, "docs/b.md", "b\n", "write b");
		// Uncommitted, so not on trunk.
		await deps.fs.write(`${root}/src/b.ts`, "b\n");

		await serving(deps, async (_snapshot, port) => {
			const report = (await (
				await fetch(`http://127.0.0.1:${port}/api/systems/changes`)
			).json()) as SystemsReport;

			expect(
				report.systems.map(({ name, files, unmatched, changed, changes }) => ({
					name,
					files,
					unmatched,
					changed,
					subjects: changes.map((change) => change.subject),
				})),
			).toEqual([
				{
					name: "docs",
					files: 2,
					unmatched: ["guides/**"],
					changed: 2,
					subjects: ["write b", "write a"],
				},
				{
					name: "src",
					files: 1,
					unmatched: [],
					changed: 1,
					subjects: ["add a"],
				},
			]);
			expect(report.scanned).toBe(6);
		});
	});

	it("serves a task's diff against its base, its uncommitted edits too", async () => {
		await add(deps, "alpha");
		const tree = (await deps.service.find("alpha")).path;
		await deps.commit(tree, "a.ts", "a\n", "add a");
		await deps.fs.write(`${tree}/a.ts`, "a\nb\n");
		await deps.fs.write(`${tree}/b.ts`, "b\n");

		await serving(deps, async (_snapshot, port) => {
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

		await serving(deps, async (_snapshot, port) => {
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
});
