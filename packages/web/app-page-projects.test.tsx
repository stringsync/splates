import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setDefaultTimeout,
} from "bun:test";
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

// Walking every page in turn outlasts the default under a loaded gate.
setDefaultTimeout(30_000);

describe("App's pages and the project switcher", () => {
	let testing: Testing;

	beforeEach(() => {
		visit("http://localhost/");
		testing = new Testing();
		testing.projects = [
			{
				slug: "wren",
				root: "/code/wren",
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

	it("leaves a desktop page's bar to its title, the sidebar's head holding the switcher", async () => {
		const view = await testing.open({ repo: "wren" });

		const switchers = [
			await switcherOn(view, "Boards"),
			await switcherOn(view, "Stats"),
			await switcherOn(view, "Ship"),
			await switcherOn(view, "Evals"),
			await switcherOn(view, "Billing"),
			await switcherOn(view, "Creds"),
			await switcherOn(view, "Automations"),
			await switcherOn(view, "Setup"),
		];
		expect(switchers).toEqual(Array(switchers.length).fill(null));
	});

	it("heads the sidebar with the project's switcher, not the server's name", async () => {
		const view = await testing.open({ repo: "wren" });
		await goTo(view, "Stats");

		const head = view
			.getByRole("button", { name: /^Switch project/ })
			.closest("header") as HTMLElement;
		const tabs = view.getByRole("tablist");
		expect([
			within(head).getByRole("button", { name: /^Switch project/ }).textContent,
			within(head).queryByRole("heading", { name: "splates" }),
			within(tabs).queryByRole("button", { name: /^Switch project/ }),
			within(tabs)
				.getAllByRole("tab")
				.map((each) => each.textContent),
		]).toEqual([
			"wren",
			null,
			null,
			[
				"Boards",
				"Creds",
				"Automations",
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
			view.queryByRole("tab", { name: /Queue/ }),
		]).toEqual(["Boards", null]);
	});

	it("heads a phone's drawer with the server and its pages, and a page's bar with the project, a separate row naming the page without chips", async () => {
		resize(390, 844);
		const view = await testing.open({
			repo: "wren",
			todos: [todo()],
			tasks: [details()],
		});

		const drawer = await openDrawer(view);
		expect([
			within(drawer).queryByRole("heading", { name: "splates" }),
			within(drawer).getByRole("button", { name: /^Switch project/ })
				.textContent,
			within(drawer).getByRole("button", { name: "Boards" }).textContent,
			within(drawer).queryByRole("button", { name: "Queue" }),
		]).toEqual([null, "wren", "Boards", null]);
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
				view.getByRole("heading", { name: "Creds" }).textContent,
			]).toEqual([null, "wren", "Creds"]),
		);
	});

	it("keeps a phone on its page when the bar's switcher picks another project", async () => {
		resize(390, 844);
		const view = await testing.open({ repo: "wren", tasks: [details()] });
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
		const view = await testing.open({ repo: "wren" });
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
		const view = await testing.open({ repo: "wren" });
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
		const view = await testing.open({ repo: "wren" });
		const drawer = await openDrawer(view);
		await act(async () =>
			fireEvent.click(within(drawer).getByRole("button", { name: "Boards" })),
		);
		await waitFor(() => expect(location.hash).toBe("#boards"));
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
				"#boards",
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
	await waitFor(
		() =>
			expect(
				view.getAllByRole("heading", { level: 2, name }).length,
			).toBeGreaterThan(0),
		{ timeout: 4000 },
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
