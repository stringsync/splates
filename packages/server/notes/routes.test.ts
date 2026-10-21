import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { json, serving } from "../server/testing";
import { Testing } from "../testing";

describe("notes page routes", () => {
	let deps: Testing;
	beforeEach(async () => {
		deps = await Testing.open();
	});
	afterEach(() => deps.disposeAsync());

	it("lists and reads notes in the main tree's configured directory", async () => {
		deps.config.notesDir = "context";
		await deps.fs.mkdir(`${deps.root}/context`);
		const path = `${deps.root}/context/a note.md`;
		await deps.fs.write(
			path,
			"---\ndescription: A convention\n---\n# Conventions\n\nUse **named exports**.\n",
		);
		await serving(deps, async (_snapshot, port) => {
			const list = await fetch(`http://127.0.0.1:${port}/api/notes`);
			expect(await list.json()).toEqual([
				{ path, description: "A convention", uses: 0 },
			]);
			const read = await fetch(
				`http://127.0.0.1:${port}/api/notes/read?${new URLSearchParams({ path })}`,
			);
			expect(await read.json()).toEqual({
				path,
				blob: expect.stringMatching(/^[0-9a-f]{40}$/),
				description: "A convention",
				text: "---\ndescription: A convention\n---\n# Conventions\n\nUse **named exports**.\n",
				body: "# Conventions\n\nUse **named exports**.\n",
			});
		});
	});

	it("returns an empty list without notes and refuses arbitrary or missing files", async () => {
		await deps.fs.write(`${deps.root}/private.md`, "not a note");
		await serving(deps, async (_snapshot, port) => {
			const list = await fetch(`http://127.0.0.1:${port}/api/notes`);
			expect(await list.json()).toEqual([]);
			const responses = await Promise.all(
				[
					`${deps.root}/private.md`,
					`${deps.root}/notes/missing.md`,
					"../private.md",
				].map((path) =>
					fetch(
						`http://127.0.0.1:${port}/api/notes/read?${new URLSearchParams({ path })}`,
					),
				),
			);
			expect(responses.map((response) => response.status)).toEqual([
				404, 404, 404,
			]);
		});
	});

	it("lands a note the page saves and reads it back", async () => {
		await serving(deps, async (_snapshot, port) => {
			const saved = await json(port, "/api/notes/save", "POST", {
				path: null,
				file: "a.md",
				description: "A convention",
				body: "Use named exports.",
				from: null,
			});
			const path = `${deps.root}/notes/a.md`;
			expect(await saved.json()).toMatchObject({ status: "landed", path });
			const read = await fetch(
				`http://127.0.0.1:${port}/api/notes/read?${new URLSearchParams({ path })}`,
			);
			expect(await read.json()).toMatchObject({
				description: "A convention",
				body: "\nUse named exports.\n",
			});
		});
	});
});
