import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	Testing,
	within,
} from "./testing";

/** Puts the page at `url`, which `history` cannot do from `about:blank`. */
function visit(url: string): void {
	(
		window as unknown as { happyDOM: { setURL(url: string): void } }
	).happyDOM.setURL(url);
}

const WREN = { root: "/code/wren", repo: "wren" };

describe("App's New, by project", () => {
	let testing: Testing;
	let view: Awaited<ReturnType<Testing["openConversations"]>>;

	beforeEach(async () => {
		visit("http://localhost/");
		localStorage.clear();
		testing = new Testing();
		testing.projects = [
			{
				slug: "wren",
				root: "/code/wren",
				gone: false,
				focused: true,
				conversations: [],
				waiting: 0,
			},
			{
				slug: "shop",
				root: "/code/shop",
				gone: false,
				focused: false,
				conversations: [],
				waiting: 0,
			},
		];
		view = await testing.openConversations(
			[conversation({ id: "c1" })],
			"c1",
			WREN,
		);
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		visit("about:blank");
		localStorage.clear();
		sessionStorage.clear();
	});

	it("opens New in the project the page shows, one a conversation last started in elsewhere aside", async () => {
		// What an older page kept for New, which no longer leads it elsewhere.
		localStorage.setItem(
			"splates.newConversationProject",
			JSON.stringify({ slug: "shop", root: "/code/shop" }),
		);

		await act(async () =>
			fireEvent.click(
				within(view.getByRole("tablist")).getByRole("button", {
					name: "New conversation",
				}),
			),
		);

		expect(testing.visited).toEqual([]);
		expect(location.hash).toBe("#conversations/new");
	});
});
