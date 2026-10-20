import { describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { Notes } from "./index";

describe("project notes", () => {
	it("returns no notes for a missing or empty directory", async () => {
		const fs = new FakeFs();
		const notes = new Notes(fs);
		expect(await notes.list("/repo")).toEqual([]);
		await fs.mkdir("/repo/notes");
		expect(await notes.list("/repo")).toEqual([]);
	});

	it("reads descriptions in filename order without including bodies or other files", async () => {
		const fs = new FakeFs();
		await fs.write(
			"/repo/notes/z.md",
			"---\ndescription: Last thing\n---\nPrivate body",
		);
		await fs.write(
			"/repo/notes/a.md",
			"---\r\ndescription: 'First thing'\r\n---\r\n# A",
		);
		await fs.write("/repo/notes/image.png", "image");
		await fs.mkdir("/repo/notes/nested.md");
		await fs.write("/repo/notes/nested.md/hidden.md", "not a flat note");

		expect(await new Notes(fs).list("/repo")).toEqual([
			{ path: "/repo/notes/a.md", description: "First thing" },
			{ path: "/repo/notes/z.md", description: "Last thing" },
		]);
	});

	it("reads a directory configured relative to the checkout or absolutely", async () => {
		const fs = new FakeFs();
		await fs.mkdir("/repo/docs/context");
		await fs.write(
			"/repo/docs/context/a.md",
			"---\ndescription: Convention\n---\n",
		);
		const notes = new Notes(fs);
		expect(await notes.list("/repo", { notesDir: "docs/context" })).toEqual([
			{ path: "/repo/docs/context/a.md", description: "Convention" },
		]);
		expect(
			await notes.list("/elsewhere", { notesDir: "/repo/docs/context" }),
		).toEqual([{ path: "/repo/docs/context/a.md", description: "Convention" }]);
	});

	it.each([
		"# No frontmatter",
		"---\ndescription: \n---\n",
		"---\ndescription: |\n  several lines\n---\n",
	])("reports a malformed note by path: %s", async (text) => {
		const fs = new FakeFs();
		await fs.mkdir("/repo/notes");
		await fs.write("/repo/notes/broken.md", text);
		await expect(new Notes(fs).list("/repo")).rejects.toThrow(
			"/repo/notes/broken.md: frontmatter needs a one-line description",
		);
	});
});
