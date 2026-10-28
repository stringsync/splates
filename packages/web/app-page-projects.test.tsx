import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	details,
	fireEvent,
	resize,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

/** Puts the page at `url`, which `history` cannot do from `about:blank`. */
function visit(url: string): void {
	(
		window as unknown as { happyDOM: { setURL(url: string): void } }
	).happyDOM.setURL(url);
}

describe("App's pages and the project switcher", () => {
	let testing: Testing;

	beforeEach(() => {
		visit("http://localhost/");
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
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		visit("about:blank");
		sessionStorage.clear();
		resize(1024, 768);
	});

	it("heads project pages with a switcher beside their titles, and Everywhere pages without one", async () => {
		const view = await testing.open({ repo: "webappwiz" });

		const switchers = [
			await switcherOn(view, "Board"),
			await switcherOn(view, "Queue"),
			await switcherOn(view, "Billing"),
			await switcherOn(view, "Creds"),
			await switcherOn(view, "Automations"),
		];
		expect(switchers).toEqual([
			"webappwiz",
			null,
			null,
			"webappwiz",
			"webappwiz",
		]);
	});

	it("heads the sidebar with the project's switcher, its own pages first under it", async () => {
		const view = await testing.open({ repo: "webappwiz" });
		await goTo(view, "Stats");

		const tabs = view.getByRole("tablist");
		expect([
			view.getByRole("button", { name: /^Switch project/ }).textContent,
			within(tabs).queryByRole("button", { name: /^Switch project/ }),
			within(tabs)
				.getAllByRole("tab")
				.map((each) => each.textContent),
		]).toEqual([
			"webappwiz",
			null,
			[
				"Board",
				"Creds",
				"Automations",
				"Queue",
				"Stats",
				"Ship",
				"Evals",
				"Billing",
				"Setup",
			],
		]);
	});

	it("counts nothing beside the sidebar's Todos and Queue", async () => {
		const view = await testing.open({
			todos: [todo(), todo({ id: 2 })],
			tasks: [details()],
		});

		expect([
			view.getByRole("tab", { name: /Board/ }).textContent,
			view.getByRole("tab", { name: /Queue/ }).textContent,
		]).toEqual(["Board", "Queue"]);
	});

	it("heads a phone's drawer with the server and its pages, and a page's bar with the project, its chips naming the page", async () => {
		resize(390, 844);
		const view = await testing.open({
			repo: "webappwiz",
			todos: [todo()],
			tasks: [details()],
		});

		const drawer = await openDrawer(view);
		expect([
			within(drawer).getByRole("heading", { level: 1 }).textContent,
			within(drawer).queryByRole("button", { name: /^Switch project/ }),
			within(drawer).getByRole("button", { name: "Board" }).textContent,
			within(drawer).getByRole("button", { name: "Queue" }).textContent,
		]).toEqual(["splates", null, "Board", "Queue"]);
		await act(async () =>
			fireEvent.click(within(drawer).getByRole("button", { name: "Creds" })),
		);

		const bar = await waitFor(() => {
			const header = view.container.querySelector("header");
			expect(header).not.toBeNull();
			return header as HTMLElement;
		});
		await waitFor(() =>
			expect([
				within(bar).queryByRole("heading", { name: "Creds" }),
				within(bar).getByRole("button", { name: /^Switch project/ })
					.textContent,
				within(view.getByRole("navigation", { name: "pages" })).getByRole(
					"button",
					{ current: "page" },
				).textContent,
			]).toEqual([null, "webappwiz", "Creds"]),
		);
	});

	it("keeps a phone on its page when the bar's switcher picks another project", async () => {
		resize(390, 844);
		const view = await testing.open({ repo: "webappwiz", tasks: [details()] });
		const drawer = await openDrawer(view);
		await act(async () =>
			fireEvent.click(within(drawer).getByRole("button", { name: "Creds" })),
		);
		const bar = await waitFor(() => {
			const header = view.container.querySelector("header");
			expect(header).not.toBeNull();
			return header as HTMLElement;
		});
		await act(async () =>
			fireEvent.click(
				within(bar).getByRole("button", { name: /^Switch project/ }),
			),
		);
		await act(async () =>
			fireEvent.click(await waitFor(() => view.getByText("/code/shop"))),
		);

		expect([location.search, location.hash]).toEqual([
			"?project=shop",
			"#creds",
		]);
	});

	it("keeps a phone on its inbox when the switcher picks a project last left in a thread", async () => {
		resize(390, 844);
		sessionStorage.setItem(
			"splates.places",
			JSON.stringify({ shop: { hash: "#conversations/abc" } }),
		);
		const view = await testing.open({ repo: "webappwiz" });
		await act(async () =>
			fireEvent.click(
				view.getAllByRole("button", {
					name: /^Switch project/,
				})[0] as HTMLElement,
			),
		);
		await act(async () =>
			fireEvent.click(await waitFor(() => view.getByText("/code/shop"))),
		);

		expect([location.search, location.hash]).toEqual([
			"?project=shop",
			"#conversations",
		]);
	});

	it("keeps the board when the switcher picks a project last left in a thread", async () => {
		sessionStorage.setItem(
			"splates.places",
			JSON.stringify({ shop: { hash: "#conversations/abc" } }),
		);
		const view = await testing.open({ repo: "webappwiz" });
		await act(async () =>
			fireEvent.click(
				view.getAllByRole("button", {
					name: /^Switch project/,
				})[0] as HTMLElement,
			),
		);
		await act(async () =>
			fireEvent.click(await waitFor(() => view.getByText("/code/shop"))),
		);

		expect([location.search, location.hash]).toEqual([
			"?project=shop",
			"#todos",
		]);
	});

	it("keeps a phone on the board when the switcher picks a project last left in a thread", async () => {
		resize(390, 844);
		sessionStorage.setItem(
			"splates.places",
			JSON.stringify({ shop: { hash: "#conversations/abc" } }),
		);
		const view = await testing.open({ repo: "webappwiz" });
		const drawer = await openDrawer(view);
		await act(async () =>
			fireEvent.click(within(drawer).getByRole("button", { name: "Board" })),
		);
		await waitFor(() => expect(location.hash).toBe(""));
		const bar = await waitFor(() => {
			const header = view.container.querySelector("header");
			expect(header).not.toBeNull();
			return header as HTMLElement;
		});
		await act(async () =>
			fireEvent.click(
				within(bar).getByRole("button", { name: /^Switch project/ }),
			),
		);
		await act(async () =>
			fireEvent.click(await waitFor(() => view.getByText("/code/shop"))),
		);

		await waitFor(() =>
			expect([location.search, location.hash]).toEqual([
				"?project=shop",
				"#todos",
			]),
		);
	});
});

/** Goes to the page whose sidebar tab is `name`. */
async function goTo(
	view: ReturnType<typeof within>,
	name: string,
): Promise<void> {
	await act(async () =>
		fireEvent.click(view.getByRole("tab", { name: new RegExp(name) })),
	);
	await waitFor(() =>
		expect(
			view.getAllByRole("heading", { level: 2, name }).length,
		).toBeGreaterThan(0),
	);
}

/** Opens a phone's drawer of pages. */
async function openDrawer(
	view: ReturnType<typeof within>,
): Promise<HTMLElement> {
	await act(async () =>
		fireEvent.click(view.getByRole("button", { name: "Open menu" })),
	);
	return waitFor(() => view.getByRole("dialog", { name: "Pages" }));
}

/** The bar atop the page shown, once its title is in it. */
async function barOf(view: ReturnType<typeof within>): Promise<HTMLElement> {
	return waitFor(() => {
		const heading = view
			.queryAllByRole("heading", { level: 2 })
			.find((each: HTMLElement) => each.closest("header") !== null);
		const bar = heading?.closest("header");
		expect(bar).toBeTruthy();
		return bar as HTMLElement;
	});
}

/** What a switcher in the bar of the page `name` names, or null when it has none. */
async function switcherOn(
	view: ReturnType<typeof within>,
	name: string,
): Promise<string | null> {
	await goTo(view, name);
	const bar = await barOf(view);
	return (
		within(bar).queryByRole("button", { name: /^Switch project/ })
			?.textContent ?? null
	);
}
