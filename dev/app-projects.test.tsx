import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { act, cleanup, fireEvent, snapshot, Testing, waitFor } from "./testing";

/** Puts the page at `url`, which `history` cannot do from `about:blank`. */
function visit(url: string): void {
	(
		window as unknown as { happyDOM: { setURL(url: string): void } }
	).happyDOM.setURL(url);
}

describe("App's projects", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		testing.projects = [
			{
				slug: "webappwiz",
				root: "/code/webappwiz",
				gone: false,
				here: true,
				conversations: [],
			},
			{
				slug: "shop",
				root: "/code/shop",
				gone: false,
				here: false,
				conversations: [],
			},
			{
				slug: "old",
				root: "/code/old",
				gone: true,
				here: false,
				conversations: [],
			},
		];
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		visit("about:blank");
	});

	it("opens the switcher on ⌘K, narrows it as you type, and goes to the pick on Enter", async () => {
		const view = await testing.open();
		const assign = spyOn(location, "assign").mockImplementation(() => {});

		await act(async () =>
			fireEvent.keyDown(window, { key: "k", metaKey: true }),
		);
		const find = await waitFor(() =>
			view.getByRole("textbox", { name: "find a project" }),
		);
		await waitFor(() => expect(view.getByText("/code/shop")).toBeTruthy());
		await act(async () => fireEvent.change(find, { target: { value: "sh" } }));
		expect(view.queryByText("/code/webappwiz")).toBeNull();
		await act(async () => fireEvent.keyDown(find, { key: "Enter" }));

		expect(assign).toHaveBeenCalledTimes(1);
		expect(new URL(String(assign.mock.calls[0]?.[0])).search).toBe(
			"?project=shop",
		);
		assign.mockRestore();
	});

	it("asks the server for the project the address names", async () => {
		visit("http://localhost/?project=shop");
		const asked: string[] = [];
		const fetched = globalThis.fetch;
		globalThis.fetch = ((path: string, init?: RequestInit) => {
			asked.push(path);
			return fetched(path, init);
		}) as typeof fetch;
		testing.served = snapshot();

		await testing.open();

		expect(asked).toContain("/api/snapshot?project=shop");
		globalThis.fetch = fetched;
	});

	it("forgets a project that is gone", async () => {
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Switch project" })),
		);

		const forget = await waitFor(() =>
			view.getByRole("button", { name: "Forget old" }),
		);
		await act(async () => fireEvent.click(forget));

		expect(testing.posts).toContainEqual(
			expect.objectContaining({ path: "/api/projects/old", method: "DELETE" }),
		);
	});
});
