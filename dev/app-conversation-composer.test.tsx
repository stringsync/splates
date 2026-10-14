import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	type ConversationsView,
	cleanup,
	conversation,
	fireEvent,
	Testing,
	textIn,
	typeIn,
	waitFor,
	within,
} from "./testing";

describe("App's composer", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const skilled = conversation({
		commands: [
			{ name: "arbor", description: "Land work on trunk", hint: null },
			{ name: "code-review", description: "Review the diff", hint: null },
			{ name: "init", description: "Write a CLAUDE.md", hint: null },
		],
	});
	const composer = async () => {
		const view = await testing.openConversations([skilled]);
		const box = view.getByRole("textbox", {
			name: "Message input",
		});
		return { view, box };
	};

	it("lists the agent's skills for a / at the start, filtered as typed, and writes the one picked", async () => {
		const { view, box } = await composer();

		await typeIn(box, "/");
		const list = await waitFor(() => view.getByRole("listbox"));
		expect(
			within(list)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual([
			"/arborLand work on trunk",
			"/code-reviewReview the diff",
			"/initWrite a CLAUDE.md",
		]);

		await typeIn(box, "/rev");
		expect(
			within(view.getByRole("listbox"))
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["/code-reviewReview the diff"]);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		expect(textIn(box)).toBe("/code-review ");
		// Enter picked a command; it did not send.
		expect(testing.posted(`/api/conversations/${skilled.id}/prompt`)).toEqual(
			[],
		);
	});

	it("leaves a / anywhere but the start a character", async () => {
		const { view, box } = await composer();

		for (const text of ["see /in", "src/in"]) {
			await typeIn(box, text);
			expect(view.queryByRole("listbox")).toBeNull();
		}
	});

	const held = [conversation({ id: "c1", title: "Fix login" })];
	const box = (view: ConversationsView) =>
		view.getByRole("textbox", { name: "Message input" });

	it("shows a file picked after an @ as its chip, the text reading its path", async () => {
		testing.tree = ["src/", "src/index.ts"];
		const view = await testing.openConversations(held, "c1");

		await typeIn(box(view), "see @ind");
		await waitFor(() => view.getByRole("listbox"));
		await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));

		await waitFor(() => expect(textIn(box(view))).toBe("see @src/index.ts "));
		expect(within(box(view)).getByTitle(/\/src\/index\.ts$/).textContent).toBe(
			"index.ts",
		);
	});

	it("names file chips that share a name by the directories above them", async () => {
		testing.tree = [
			"app/",
			"app/index.ts",
			"server/",
			"server/index.ts",
			"a.ts",
		];
		localStorage.setItem(
			"arbor.draft.c1",
			"@app/index.ts @server/index.ts @a.ts",
		);
		const view = await testing.openConversations(held, "c1");

		await waitFor(() =>
			expect(
				within(box(view))
					.getAllByRole("link")
					.map((chip) => chip.textContent),
			).toEqual(["app/index.ts", "server/index.ts", "a.ts"]),
		);
	});

	it("shows the references in a draft as Resolving… until the paths and systems come, then as their chips", async () => {
		let list = () => {};
		testing.listing = new Promise((resolve) => {
			list = resolve;
		});
		testing.tree = ["src/", "src/index.ts"];
		testing.systems = [
			{ name: "playback", aliases: ["player"], globs: ["src/audio/**"] },
		];
		const draft = "fix #player in @src/index.ts, not #12 or @gone.ts";
		localStorage.setItem("arbor.draft.c1", draft);
		const view = await testing.openConversations(held, "c1");

		await waitFor(() =>
			expect(within(box(view)).getAllByText("Resolving…")).toHaveLength(3),
		);
		expect(textIn(box(view))).toBe(draft);

		await act(async () => list());

		await waitFor(() =>
			expect(within(box(view)).queryByText("Resolving…")).toBeNull(),
		);
		expect(
			within(box(view)).getByRole("button", { name: "playback" }),
		).toBeTruthy();
		expect(within(box(view)).getByTitle(/\/src\/index\.ts$/)).toBeTruthy();
		// Named nothing once they came: as written.
		expect(within(box(view)).getByText("@gone.ts")).toBeTruthy();
		expect(textIn(box(view))).toBe(draft);
	});
});
