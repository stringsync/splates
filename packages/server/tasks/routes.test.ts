import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { serving } from "../server/testing";
import { Testing } from "../testing";
import { add } from "./add";
import type { FileDiff } from "./diff";
import { remove } from "./remove";

describe("dev tasks", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("serves a file a queued task holds, and nothing else", async () => {
		await add(deps, "alpha");
		const tree = (await deps.service.find("alpha")).path;
		await deps.fs.writeBytes(`${tree}/page.png`, new Uint8Array([7]));
		const queued = await deps.tasks.add("look", null, {
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

			const shown = await file(queued.files[0] ?? "");
			expect(shown.status).toBe(200);
			expect(shown.headers.get("content-type")).toBe("image/png");
			expect(new Uint8Array(await shown.arrayBuffer())).toEqual(
				new Uint8Array([8]),
			);
			const stored = await file(queued.files[1] ?? "");
			expect(stored.status).toBe(200);
			expect(stored.headers.get("content-disposition")).toBe("attachment");
			expect((await file(`${tree}/page.png`)).status).toBe(404);
			expect((await file(`${deps.tasks.dir}/1/../../../config`)).status).toBe(
				404,
			);
		});
	});

	it("opens a task's file in the editor inside its worktree", async () => {
		await add(deps, "alpha");
		const tree = (await deps.service.find("alpha")).path;
		const bin = `${deps.root}-bin`;
		await deps.fs.mkdir(bin);
		await deps.fs.write(
			`${bin}/zed`,
			`#!/bin/sh\necho "$@" > "${bin}/opened"\n`,
		);
		await deps.fs.chmod(`${bin}/zed`, 0o755);
		deps.proc.env.PATH = `${bin}:${deps.proc.env.PATH ?? ""}`;

		await serving(deps, async (_snapshot, port) => {
			const open = (body: unknown) =>
				fetch(`http://127.0.0.1:${port}/api/open`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: `http://127.0.0.1:${port}`,
					},
					body: JSON.stringify(body),
				});

			const opened = await open({
				editor: "zed",
				path: `${tree}/README.md`,
				line: 3,
			});
			expect(opened.status).toBe(204);
			expect((await deps.fs.read(`${bin}/opened`)).trim()).toBe(
				`${tree} ${tree}/README.md:3`,
			);
			expect(
				(await open({ editor: "zed", path: "/etc/passwd", line: null })).status,
			).toBe(404);
			expect(
				(await open({ editor: "vim", path: `${tree}/README.md` })).status,
			).toBe(400);
		});
	});

	it("serves a file a conversation holds for a task, but not its log or artifacts", async () => {
		await add(deps, "alpha");
		const dir = deps.storage.locate("conversations");
		await deps.storage.log("conversations/c1.jsonl").append({ kind: "read" });
		const [shot = ""] = await deps.service
			.attached("c1", "alpha")
			.store([{ name: "shot.png", bytes: new Uint8Array([5]) }]);
		await deps.storage
			.collection("conversations/c1/artifacts")
			.writeBytes("a.png", new Uint8Array([6]));
		await deps.storage.materialize("conversations/c1/artifacts/a.png");

		await serving(deps, async (_snapshot, port) => {
			const file = (path: string) =>
				fetch(
					`http://127.0.0.1:${port}/api/file?${new URLSearchParams({ path })}`,
				);

			expect((await file(shot)).status).toBe(200);
			expect((await file(`${dir}/c1.jsonl`)).status).toBe(404);
			expect((await file(`${dir}/c1/artifacts/a.png`)).status).toBe(404);
		});
	});

	it("serves a file kept with a finished task, but not its record", async () => {
		await add(deps, "alpha");
		const [shot = ""] = await deps.service
			.attached("c1", "alpha")
			.store([{ name: "shot.png", bytes: new Uint8Array([7]) }]);
		await deps.fs.write(
			`${(await deps.service.find("alpha")).path}/SPLATES.md`,
			`![shot](${shot})`,
		);
		await remove(deps, "alpha");
		const kept = `${deps.storage.locate("finished")}/${(await deps.service.finished.list())[0]?.key}`;

		await serving(deps, async (_snapshot, port) => {
			const file = (path: string) =>
				fetch(
					`http://127.0.0.1:${port}/api/file?${new URLSearchParams({ path })}`,
				);

			const served = await file(`${kept}/${shot.split("/").at(-1)}`);
			expect(new Uint8Array(await served.arrayBuffer())).toEqual(
				new Uint8Array([7]),
			);
			expect((await file(`${kept}.md`)).status).toBe(404);
			expect((await file(`${kept}/../../config.json`)).status).toBe(404);
		});
	});

	it("serves a file a task holds in parts, but never its record", async () => {
		await add(deps, "alpha");
		const [clip = ""] =
			(await (
				await deps.service.files("alpha")
			)?.store([{ name: "run.webm", bytes: new Uint8Array([1, 2, 3, 4]) }])) ??
			[];

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
			expect(
				(await file(deps.storage.locate(await deps.recordOf("alpha")))).status,
			).toBe(404);
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

	it("grants a task out of merge attempts another round, and only one out of them", async () => {
		await add(deps, "alpha");
		await add(deps, "beta");
		await (await deps.service.find("alpha")).save({
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
