import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ConversationFeed } from "./conversation-feed";
import { NotesPage } from "./notes-page";
import { NotesReading } from "./notes-reading";
import { cleanup, conversation, fireEvent, render, Testing } from "./testing";

const NOTE = {
	path: "/repo/notes/exports.md",
	description: "Why named exports",
	text: "---\ndescription: Why named exports\n---\n# Exports\n\nUse **named exports**.",
	body: "# Exports\n\nUse **named exports**.",
};

describe("notes page", () => {
	let testing: Testing;
	beforeEach(() => {
		testing = new Testing();
		testing.notes.items = [NOTE];
	});
	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("opens a note as markdown and returns to the index", async () => {
		const page = render(<NotesPage feed={null} onOpen={() => {}} />);
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

	it("shows an empty index with a way to request the first note", async () => {
		testing.notes.items = [];
		const page = render(<NotesPage feed={null} onOpen={() => {}} />);
		expect(await page.findByText("No project notes yet")).toBeTruthy();
		fireEvent.click(page.getByRole("button", { name: /New note/ }));
		expect(page.getByLabelText("What should the note say?")).toBeTruthy();
		expect(
			page.getByText("Connect an agent to request a change."),
		).toBeTruthy();
	});

	it.each(["new", "edit", "remove"] as const)(
		"hands a %s request to an agent conversation",
		async (action) => {
			const reading = new NotesReading();
			const feed = new ConversationFeed();
			try {
				feed.agents = [
					{ id: "codex", name: "Codex", settings: [], limits: [] },
				];
				testing.talk = { agents: feed.agents, conversations: [] };
				testing.reply = conversation({ id: "note-change", agent: "codex" });
				await reading.open(NOTE.path);
				reading.request(action);
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
				expect(prompt.get("text")).toContain(
					action === "new" ? "Create a project note." : NOTE.text,
				);
			} finally {
				feed.dispose();
			}
		},
	);
});
