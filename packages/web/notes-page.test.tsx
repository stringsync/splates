import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ConversationFeed } from "./conversation-feed";
import { NotesPage } from "./notes-page";
import { NotesReading } from "./notes-reading";
import {
	cleanup,
	conversation,
	fireEvent,
	render,
	Testing,
	waitFor,
} from "./testing";

const NOTE = {
	path: "/repo/notes/exports.md",
	description: "Why named exports",
	uses: 3,
	recommended: 5,
	followed: 2,
	text: "---\ndescription: Why named exports\n---\n# Exports\n\nUse **named exports**.",
	body: "# Exports\n\nUse **named exports**.",
	blob: "abc123",
};

describe("notes page", () => {
	let testing: Testing;
	let page: ReturnType<typeof render>;
	let opened: string[];
	beforeEach(() => {
		testing = new Testing();
		testing.notes.items = [
			NOTE,
			{ ...NOTE, path: "/repo/notes/b.md", description: "Unread", uses: 0 },
		];
		opened = [];
		page = render(<NotesPage feed={null} onOpen={(id) => opened.push(id)} />);
	});
	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("lists each note with how many conversations read it, then opens one as markdown and returns to the index", async () => {
		expect(await page.findByText("Read in 3 conversations")).toBeTruthy();
		expect(page.getAllByText("Recommended 5 times, followed 2")).toHaveLength(
			2,
		);
		expect(page.getByText("Never read")).toBeTruthy();
		fireEvent.click(
			await page.findByRole("button", { name: /Why named exports/ }),
		);
		expect(await page.findByRole("heading", { name: "Exports" })).toBeTruthy();
		expect(page.container.querySelector("strong")?.textContent).toBe(
			"named exports",
		);
		fireEvent.click(page.getByRole("button", { name: "All notes" }));
		expect(
			page.getByRole("button", { name: /Why named exports/ }),
		).toBeTruthy();
	});

	it("writes a new note and lands it as a save, then shows it", async () => {
		await page.findByText("Never read");
		fireEvent.click(page.getByRole("button", { name: /New note/ }));
		const save = page.getByRole("button", { name: "Save" });
		expect(save.hasAttribute("disabled")).toBe(true);
		fireEvent.change(page.getByLabelText("Filename"), {
			target: { value: "tests" },
		});
		fireEvent.change(page.getByLabelText("Description"), {
			target: { value: "How tests run" },
		});
		fireEvent.change(page.getByLabelText("Markdown"), {
			target: { value: "Run them under **bun**." },
		});
		const saved = { ...NOTE, path: "/repo/notes/tests.md" };
		testing.notes.items.push({ ...saved, description: "How tests run" });
		testing.reply = { status: "landed", commit: "c0ffee", path: saved.path };
		fireEvent.click(save);
		expect(testing.posted("/api/notes/save")[0]?.body).toEqual({
			path: null,
			file: "tests.md",
			description: "How tests run",
			body: "Run them under **bun**.",
			from: null,
			force: false,
		});
		expect(
			await page.findByRole("heading", { name: "How tests run" }),
		).toBeTruthy();
		expect(page.getByText(saved.path)).toBeTruthy();
	});

	it("edits a note from its blob and shows a conflict to save over", async () => {
		fireEvent.click(
			await page.findByRole("button", { name: /Why named exports/ }),
		);
		fireEvent.click(await page.findByRole("button", { name: "Edit" }));
		expect((page.getByLabelText("Markdown") as HTMLTextAreaElement).value).toBe(
			NOTE.body,
		);
		fireEvent.change(page.getByLabelText("Markdown"), {
			target: { value: "Mine." },
		});
		testing.reply = {
			status: "conflict",
			why: "'alpha' is changing this note too",
			tasks: ["alpha"],
		};
		fireEvent.click(page.getByRole("button", { name: "Save" }));
		expect(
			await page.findByText("'alpha' is changing this note too"),
		).toBeTruthy();
		expect(testing.posted("/api/notes/save")[0]?.body).toMatchObject({
			path: NOTE.path,
			file: "exports.md",
			from: "abc123",
			force: false,
		});
		testing.reply = { status: "landed", commit: "c0ffee", path: NOTE.path };
		fireEvent.click(page.getByRole("button", { name: "Save over it" }));
		await waitFor(() =>
			expect(testing.posted("/api/notes/save")[1]?.body).toMatchObject({
				body: "Mine.",
				force: true,
			}),
		);
		await waitFor(() =>
			expect(page.queryByText("'alpha' is changing this note too")).toBeNull(),
		);
	});

	it("puts a refused save back in the editor with what was written", async () => {
		fireEvent.click(
			await page.findByRole("button", { name: /Why named exports/ }),
		);
		fireEvent.click(await page.findByRole("button", { name: "Edit" }));
		fireEvent.change(page.getByLabelText("Markdown"), {
			target: { value: "Mine." },
		});
		testing.reply = { status: "refused", why: "could not check it out" };
		fireEvent.click(page.getByRole("button", { name: "Save" }));
		expect(await page.findByText("could not check it out")).toBeTruthy();
		expect(page.queryByRole("button", { name: "Save over it" })).toBeNull();
		fireEvent.click(page.getByRole("button", { name: "Back to editing" }));
		expect((page.getByLabelText("Markdown") as HTMLTextAreaElement).value).toBe(
			"Mine.",
		);
	});

	it("removes a note and returns to the list", async () => {
		fireEvent.click(await page.findByRole("button", { name: /Unread/ }));
		testing.notes.items = [NOTE];
		testing.reply = { status: "landed", commit: "c0ffee", path: null };
		fireEvent.click(await page.findByRole("button", { name: "Remove" }));
		expect(testing.posted("/api/notes/remove")[0]?.body).toEqual({
			path: "/repo/notes/b.md",
			from: "abc123",
			force: false,
		});
		await waitFor(() => expect(page.queryByText("Never read")).toBeNull());
		expect(
			page.getByRole("button", { name: /Why named exports/ }),
		).toBeTruthy();
	});

	it("hands a request to change a note to an agent conversation", async () => {
		const reading = new NotesReading();
		const feed = new ConversationFeed();
		try {
			feed.agents = [{ id: "codex", name: "Codex", settings: [], limits: [] }];
			testing.talk = { agents: feed.agents, conversations: [] };
			testing.reply = conversation({ id: "note-change", agent: "codex" });
			await reading.open(NOTE.path);
			reading.request("edit");
			reading.write("Explain the reason.");
			const opened: string[] = [];
			await reading.start(feed, (id) => opened.push(id));
			expect(opened).toEqual(["note-change"]);
			expect(testing.posted("/api/conversations")[0]?.body).toMatchObject({
				agent: "codex",
				task: null,
			});
			const prompt = testing.posts[1]?.body as FormData;
			expect(prompt.get("text")).toContain("Explain the reason.");
			expect(prompt.get("text")).toContain("splates merge");
			expect(prompt.get("text")).toContain(NOTE.text);
		} finally {
			feed.dispose();
		}
	});
});
