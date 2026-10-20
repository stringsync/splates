import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ConversationFeed } from "./conversation-feed";
import { Drafts, newDraft } from "./drafts";
import { NotesPage } from "./notes-page";
import { NEW_NOTE, NotesReading } from "./notes-reading";
import { cleanup, conversation, fireEvent, render, Testing } from "./testing";

const NOTE = {
	path: "/repo/notes/exports.md",
	description: "Why named exports",
	uses: 3,
	text: "---\ndescription: Why named exports\n---\n# Exports\n\nUse **named exports**.",
	body: "# Exports\n\nUse **named exports**.",
};

describe("notes page", () => {
	let testing: Testing;
	let page: ReturnType<typeof render>;
	let drafts: Drafts;
	let opened: string[];
	beforeEach(() => {
		testing = new Testing();
		testing.notes.items = [
			NOTE,
			{ ...NOTE, path: "/repo/notes/b.md", description: "Unread", uses: 0 },
		];
		drafts = new Drafts(localStorage, null);
		opened = [];
		page = render(
			<NotesPage
				feed={null}
				drafts={drafts}
				onOpen={(id) => opened.push(id)}
			/>,
		);
	});
	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("lists each note with how many conversations read it, then opens one as markdown and returns to the index", async () => {
		expect(await page.findByText("Read in 3 conversations")).toBeTruthy();
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

	it("opens one new conversation seeded to write a note, keeping what was typed", async () => {
		await page.findByText("Never read");
		fireEvent.click(page.getByRole("button", { name: /New note/ }));
		expect(opened).toEqual(["new?draft=note"]);
		const key = newDraft(null, null, "note");
		expect(drafts.read(key)).toBe(NEW_NOTE);
		drafts.write(key, `${NEW_NOTE}Why named exports`);
		fireEvent.click(page.getByRole("button", { name: /New note/ }));
		expect(opened).toEqual(["new?draft=note", "new?draft=note"]);
		expect(drafts.read(key)).toBe(`${NEW_NOTE}Why named exports`);
	});

	it.each(["edit", "remove"] as const)(
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
				expect(prompt.get("text")).toContain(NOTE.text);
			} finally {
				feed.dispose();
			}
		},
	);
});
