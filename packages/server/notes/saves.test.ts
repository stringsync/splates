import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setDefaultTimeout,
} from "bun:test";
import { join } from "node:path";
import { add } from "../tasks";
import { Testing } from "../testing";
import { NoteSaves } from "./saves";

// Real git, a commit per save.
setDefaultTimeout(30_000);

const NOTE = "---\ndescription: Why named exports\n---\n\nUse named exports.\n";

describe("note saves", () => {
	let deps: Testing;
	let saves: NoteSaves;
	let path: string;
	let blob: string | null;
	beforeEach(async () => {
		deps = await Testing.open();
		await deps.fs.mkdir(join(deps.root, "notes"));
		await deps.commit(deps.root, "notes/exports.md", NOTE, "add a note");
		saves = new NoteSaves(deps);
		path = join(deps.root, "notes/exports.md");
		blob = await saves.blob(path);
	});
	afterEach(() => deps.disposeAsync());

	/** Trunk's last commit message and the note files it holds. */
	const trunk = async () => ({
		message: await deps.gitCli(deps.root, "log", "-1", "--format=%s", "main"),
		files: (
			await deps.gitCli(deps.root, "ls-tree", "--name-only", "main", "notes/")
		).split("\n"),
	});

	it("lands a new note as its own commit, checked out in the main tree", async () => {
		expect(
			await saves.save({
				path: null,
				file: "tests.md",
				description: "How tests run",
				body: "Run them under bun.",
				from: null,
			}),
		).toMatchObject({
			status: "landed",
			path: join(deps.root, "notes/tests.md"),
		});
		expect(await trunk()).toEqual({
			message: "Add note tests.md: How tests run",
			files: ["notes/exports.md", "notes/tests.md"],
		});
		expect(await deps.fs.read(join(deps.root, "notes/tests.md"))).toBe(
			"---\ndescription: How tests run\n---\n\nRun them under bun.\n",
		);
		expect(await deps.gitCli(deps.root, "status", "--porcelain")).toBe("");
	});

	it("edits, renames and removes a note, keeping its other frontmatter", async () => {
		await deps.commit(
			deps.root,
			"notes/exports.md",
			"---\ndescription: Old\nowner: web\n---\nOld body\n",
			"tag the note",
		);
		expect(
			await saves.save({
				path,
				file: "exports.md",
				description: "Why named exports",
				body: "Name every export.",
				from: await saves.blob(path),
			}),
		).toMatchObject({ status: "landed" });
		expect((await trunk()).message).toBe(
			"Edit note exports.md: Why named exports",
		);
		expect(await deps.fs.read(path)).toBe(
			"---\ndescription: Why named exports\nowner: web\n---\n\nName every export.\n",
		);
		const renamed = await saves.save({
			path,
			file: "named-exports.md",
			description: "Why named exports",
			body: "Name every export.",
			from: await saves.blob(path),
		});
		expect(renamed).toMatchObject({
			status: "landed",
			path: join(deps.root, "notes/named-exports.md"),
		});
		expect(await trunk()).toEqual({
			message: "Rename note exports.md to named-exports.md",
			files: ["notes/named-exports.md"],
		});
		const moved = join(deps.root, "notes/named-exports.md");
		expect(
			await saves.remove({ path: moved, from: await saves.blob(moved) }),
		).toMatchObject({ status: "landed", path: null });
		expect((await trunk()).message).toBe("Remove note named-exports.md");
		expect(await deps.fs.exists(moved)).toBe(false);
	});

	it("refuses a note changed on trunk since it was opened until forced", async () => {
		await deps.commit(
			deps.root,
			"notes/exports.md",
			`${NOTE}More.\n`,
			"change the note",
		);
		const save = {
			path,
			file: "exports.md",
			description: "Why named exports",
			body: "Mine.",
			from: blob,
		};
		expect(await saves.save(save)).toEqual({
			status: "conflict",
			why: "this note changed on trunk since you opened it",
			tasks: [],
		});
		expect((await trunk()).message).toBe("change the note");
		expect(await saves.save({ ...save, force: true })).toMatchObject({
			status: "landed",
		});
	});

	it("names an open task changing the same note as a conflict", async () => {
		await add(deps, "alpha");
		const tree = (await deps.service.find("alpha")).path;
		await deps.commit(tree, "notes/exports.md", `${NOTE}Theirs.\n`, "theirs");
		const removal = { path, from: blob };
		expect(await saves.remove(removal)).toMatchObject({
			status: "conflict",
			tasks: ["alpha"],
		});
		expect(await saves.remove({ ...removal, force: true })).toMatchObject({
			status: "landed",
		});
	});

	it("refuses an edit the main tree holds uncommitted, leaving trunk and the edit", async () => {
		await deps.fs.write(path, `${NOTE}Uncommitted.\n`);
		const before = await deps.git.head(deps.root);
		expect(
			await saves.save({
				path,
				file: "exports.md",
				description: "Why named exports",
				body: "Mine.",
				from: blob,
				force: true,
			}),
		).toMatchObject({ status: "refused" });
		expect(await deps.git.head(deps.root)).toBe(before);
		expect(await deps.fs.read(path)).toBe(`${NOTE}Uncommitted.\n`);
	});

	it.each([
		["a description", { description: "" }],
		["a one-line description", { description: "two\nlines" }],
		["a plain filename", { file: "../escape.md" }],
		["a markdown filename", { file: "note.txt" }],
	])("refuses a note without %s", async (_what, change) => {
		expect(
			await saves.save({
				path: null,
				file: "new.md",
				description: "New",
				body: "",
				from: null,
				...change,
			}),
		).toMatchObject({ status: "refused" });
	});

	it("refuses a new note over one that exists", async () => {
		expect(
			await saves.save({
				path: null,
				file: "exports.md",
				description: "Again",
				body: "",
				from: null,
			}),
		).toMatchObject({ status: "refused" });
		expect((await trunk()).message).toBe("add a note");
	});
});
