import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
	act,
	cleanup,
	fireEvent,
	snapshot,
	Testing,
	waitFor,
	within,
} from "./testing";

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
			{
				slug: "old",
				root: "/code/old",
				gone: true,
				here: false,
				conversations: [],
				waiting: 0,
			},
		];
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		visit("about:blank");
		sessionStorage.clear();
	});

	it("opens the switcher on ⌃⌘P, narrows it as you type, and goes to the pick on Enter", async () => {
		const view = await testing.open();
		const assign = spyOn(location, "assign").mockImplementation(() => {});

		await act(async () =>
			fireEvent.keyDown(window, {
				key: "p",
				code: "KeyP",
				ctrlKey: true,
				metaKey: true,
			}),
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

	it("marks each project with how many agents wait on you there", async () => {
		const view = await testing.open();

		await act(async () =>
			fireEvent.keyDown(window, {
				key: "p",
				code: "KeyP",
				ctrlKey: true,
				metaKey: true,
			}),
		);
		const waiting = await waitFor(() =>
			view.getByRole("status", { name: "2 waiting on you" }),
		);
		expect(waiting.closest("li")?.textContent).toContain("shop");
		expect(
			view.queryAllByRole("status", { name: /waiting on you/ }),
		).toHaveLength(1);
	});

	it("marks the closed switcher while another project has agents waiting on you", async () => {
		const view = await testing.open();

		await waitFor(() =>
			expect(
				view.getByRole("button", {
					name: "Switch project: 2 waiting on you in shop",
				}),
			).toBeTruthy(),
		);
	});

	it("leaves the agents waiting in the project shown off the switcher's mark", async () => {
		visit("http://localhost/?project=shop");
		const [started] = testing.projects;
		if (started) {
			started.waiting = 1;
		}
		const view = await testing.open();

		await waitFor(() =>
			expect(
				view.getByRole("button", {
					name: "Switch project: 1 waiting on you in webappwiz",
				}),
			).toBeTruthy(),
		);
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

	it("says it is opening the project the address names until its snapshot arrives", async () => {
		visit("http://localhost/?project=shop");
		let arrive = () => {};
		const held = new Promise<void>((resolve) => {
			arrive = resolve;
		});
		const fetched = globalThis.fetch;
		globalThis.fetch = (async (path: string, init?: RequestInit) => {
			if (path.startsWith("/api/snapshot")) {
				await held;
			}
			return fetched(path, init);
		}) as typeof fetch;

		const opening = testing.open();
		const screen = within(document.body);
		const status = await waitFor(() => screen.getByText("Opening shop"));
		expect(status.getAttribute("role")).toBe("status");
		expect(
			screen.getByRole("button", { name: /^Switch project/ }).textContent,
		).toBe("shop");
		arrive();
		await opening;

		expect(screen.queryByText("Opening shop")).toBeNull();
		globalThis.fetch = fetched;
	});

	it("comes back to the conversation it left a project on", async () => {
		visit("http://localhost/");
		const view = await testing.open();
		history.replaceState(null, "", "#conversations/c1");
		const assign = spyOn(location, "assign").mockImplementation(() => {});
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^Switch project/ })),
		);
		const shop = await waitFor(() => view.getByText("/code/shop"));
		await act(async () => fireEvent.click(shop));
		const there = new URL(String(assign.mock.calls[0]?.[0]));
		expect(there.search).toBe("?project=shop");
		expect(there.hash).toBe("#conversations");
		cleanup();

		visit(there.toString());
		const back = await testing.open();
		await act(async () =>
			fireEvent.click(back.getByRole("button", { name: /^Switch project/ })),
		);
		const home = await waitFor(() => back.getByText("/code/webappwiz"));
		await act(async () => fireEvent.click(home));

		const returned = new URL(String(assign.mock.calls[1]?.[0]));
		expect(returned.search).toBe("");
		expect(returned.hash).toBe("#conversations/c1");
		assign.mockRestore();
	});

	it("names the project started in while it opens again", async () => {
		await testing.open({ repo: "webappwiz" });
		cleanup();

		visit("http://localhost/");
		let arrive = () => {};
		const held = new Promise<void>((resolve) => {
			arrive = resolve;
		});
		const fetched = globalThis.fetch;
		globalThis.fetch = (async (path: string, init?: RequestInit) => {
			if (path.startsWith("/api/snapshot")) {
				await held;
			}
			return fetched(path, init);
		}) as typeof fetch;

		const opening = testing.open();
		const screen = within(document.body);
		await waitFor(() => screen.getByText("Opening webappwiz"));
		arrive();
		await opening;
		globalThis.fetch = fetched;
	});

	it("forgets a project that is gone", async () => {
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^Switch project/ })),
		);

		const forget = await waitFor(() =>
			view.getByRole("button", { name: "Forget old" }),
		);
		await act(async () => fireEvent.click(forget));

		expect(testing.posts).toContainEqual(
			expect.objectContaining({ path: "/api/projects/old", method: "DELETE" }),
		);
	});

	it("forgets one still there, but never the one shown or started in", async () => {
		visit("http://localhost/?project=old");
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^Switch project/ })),
		);

		const forget = await waitFor(() =>
			view.getByRole("button", { name: "Forget shop" }),
		);
		expect(view.queryByRole("button", { name: "Forget webappwiz" })).toBeNull();
		expect(view.queryByRole("button", { name: "Forget old" })).toBeNull();
		await act(async () => fireEvent.click(forget));

		expect(testing.posts).toContainEqual(
			expect.objectContaining({ path: "/api/projects/shop", method: "DELETE" }),
		);
	});
});
