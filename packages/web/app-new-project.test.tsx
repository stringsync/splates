import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, cleanup, conversation, fireEvent, Testing } from "./testing";

/** Puts the page at `url`, which `history` cannot do from `about:blank`. */
function visit(url: string): void {
	(
		window as unknown as { happyDOM: { setURL(url: string): void } }
	).happyDOM.setURL(url);
}

/**
 * The project New starts in next, as `new-conversation-project.ts` keeps it,
 * read here rather than through it: importing it ahead of `./testing` would
 * build its navigation before the DOM is there.
 */
const LAST = "splates.newConversationProject";

function _lastProject(): unknown {
	return JSON.parse(localStorage.getItem(LAST) ?? "null");
}

function rememberProject(project: { slug: string; root: string }): void {
	localStorage.setItem(LAST, JSON.stringify(project));
}

const WEBAPPWIZ = { root: "/code/webappwiz", repo: "webappwiz" };

describe("App's New, by project", () => {
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
			WEBAPPWIZ,
		);
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		visit("about:blank");
		localStorage.clear();
		sessionStorage.clear();
	});

	it("opens New in the project last used, from another project's page", async () => {
		rememberProject({ slug: "shop", root: "/code/shop" });

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "New" })),
		);

		const there = new URL(String(testing.visited.at(-1)));
		expect(there.search).toBe("?project=shop");
		expect(there.hash).toBe("#conversations/new");
	});

	it("opens New on the page when it shows the project last used", async () => {
		rememberProject({ slug: "webappwiz", root: "/code/webappwiz" });

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "New" })),
		);

		expect(testing.visited).toEqual([]);
		expect(location.hash).toBe("#conversations/new");
	});
});
