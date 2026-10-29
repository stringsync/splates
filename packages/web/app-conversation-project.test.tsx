import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { newDraft } from "./drafts";
import {
	act,
	cleanup,
	clickShown,
	fireEvent,
	Testing,
	typeIn,
	waitFor,
	within,
} from "./testing";

/** Puts the page at `url`, which `history` cannot do from `about:blank`. */
function visit(url: string): void {
	(
		window as unknown as { happyDOM: { setURL(url: string): void } }
	).happyDOM.setURL(url);
}

const WEBAPPWIZ = { root: "/code/webappwiz", repo: "webappwiz" };

describe("App's new conversation, by project", () => {
	let testing: Testing;
	let view: Awaited<ReturnType<Testing["openConversations"]>>;

	beforeEach(async () => {
		visit("http://localhost/");
		localStorage.clear();
		testing = new Testing();
		testing.projects = [
			{
				slug: "webappwiz",
				root: "/code/webappwiz",
				gone: false,
				focused: true,
				conversations: [],
				waiting: 0,
				ships: false,
			},
			{
				slug: "shop",
				root: "/code/shop",
				gone: false,
				focused: false,
				conversations: [],
				waiting: 0,
				ships: false,
			},
		];
		// With none open, the page starts a new one.
		view = await testing.openConversations([], null, WEBAPPWIZ);
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		visit("about:blank");
		localStorage.clear();
		sessionStorage.clear();
	});

	it("names its project above the composer alone, and a pick shows that project's, what was typed carried along", async () => {
		const home = view.getByRole("region", { name: "new conversation" });
		expect(
			view.getAllByRole("button", { name: "Switch project" }),
		).toHaveLength(1);
		const box = within(home).getByRole("textbox", { name: "Message input" });
		await typeIn(box, "fix the login");

		await act(async () =>
			fireEvent.click(
				within(home).getByRole("button", { name: /^Switch project/ }),
			),
		);
		await clickShown(() => view.getByText("/code/shop"));

		const there = new URL(String(testing.visited.at(-1)));
		expect(there.search).toBe("?project=shop");
		expect(there.hash).toBe("#conversations/new/claude");
		expect(localStorage.getItem(`splates.draft.${newDraft("shop")}`)).toBe(
			"fix the login",
		);
		expect(localStorage.getItem(`splates.draft.${newDraft(null)}`)).toBeNull();
	});

	it("offers General in a section above the projects, carrying what was typed there", async () => {
		const home = view.getByRole("region", { name: "new conversation" });
		await typeIn(
			within(home).getByRole("textbox", { name: "Message input" }),
			"plan a trip",
		);

		await act(async () =>
			fireEvent.click(
				within(home).getByRole("button", { name: /^Switch project/ }),
			),
		);
		const general = await waitFor(() =>
			view.getByRole("list", { name: "general" }),
		);
		const rows = (list: HTMLElement) =>
			within(list)
				.getAllByRole("listitem")
				.map((each) => [
					each.textContent,
					within(each).queryAllByRole("button").length,
				]);
		// General in a section of its own, without a project's menu.
		expect(rows(general)).toEqual([["GeneralNo project", 1]]);
		expect(rows(view.getByRole("list", { name: "projects" }))).toEqual([
			["shop/code/shop", 2],
			["webappwiz/code/webappwizcurrent", 2],
		]);
		await act(async () =>
			fireEvent.click(within(general).getByText("General")),
		);

		const there = new URL(String(testing.visited.at(-1)));
		expect(there.searchParams.get("project")).toBe("~general");
		expect(there.hash).toBe("#conversations/new/claude");
		expect(localStorage.getItem(`splates.draft.${newDraft("~general")}`)).toBe(
			"plan a trip",
		);
	});
});
