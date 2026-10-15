import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, cleanup, fireEvent, Testing, waitFor, within } from "./testing";

/** Puts the page at `url`, which `history` cannot do from `about:blank`. */
function visit(url: string): void {
	(
		window as unknown as { happyDOM: { setURL(url: string): void } }
	).happyDOM.setURL(url);
}

describe("App coming back to a project", () => {
	let testing: Testing;

	beforeEach(() => {
		visit("http://localhost/");
		testing = new Testing();
		testing.projects = [
			{
				slug: "webappwiz",
				root: "/code/webappwiz",
				gone: false,
				here: true,
				conversations: [],
				waiting: 0,
			},
			{
				slug: "shop",
				root: "/code/shop",
				gone: false,
				here: false,
				conversations: [],
				waiting: 2,
			},
		];
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		visit("about:blank");
		sessionStorage.clear();
	});

	it("comes back to the conversation it left a project on", async () => {
		const view = await testing.open();
		history.replaceState(null, "", "#conversations/c1");
		await pick(view, "/code/shop");
		const there = new URL(String(testing.visited[0]));
		expect(there.search).toBe("?project=shop");
		expect(there.hash).toBe("#conversations");
		cleanup();

		visit(there.toString());
		const back = await testing.open();
		await pick(back, "/code/webappwiz");

		const returned = new URL(String(testing.visited[1]));
		expect(returned.search).toBe("");
		expect(returned.hash).toBe("#conversations/c1");
	});

	it("names the project started in while it opens again", async () => {
		await testing.open({ repo: "webappwiz" });
		cleanup();

		const arrive = testing.holdSnapshots();

		const opening = testing.open();
		const screen = within(document.body);
		await waitFor(() => screen.getByText("Opening webappwiz"));
		arrive();
		await opening;
	});
});

/** Opens the project switcher in `view` and picks the project at `root`. */
async function pick(
	view: ReturnType<typeof within>,
	root: string,
): Promise<void> {
	await act(async () =>
		fireEvent.click(view.getByRole("button", { name: /^Switch project/ })),
	);
	const project = await waitFor(() => view.getByText(root));
	await act(async () => fireEvent.click(project));
}
