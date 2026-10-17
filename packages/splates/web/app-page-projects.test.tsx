import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rememberPlace } from "./project-places";
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

describe("App's pages picking their project", () => {
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
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		visit("about:blank");
		sessionStorage.clear();
		resize(1024, 768);
	});

	it("heads Todos, Systems, Budget and Creds with the project they show", async () => {
		const view = await testing.open({ repo: "webappwiz" });

		await goTo(view, "Todos");
		expect(await switcherIn(view)).toBe("webappwiz");
		await goTo(view, "Systems");
		expect(await switcherIn(view)).toBe("webappwiz");
		await goTo(view, "Budget");
		expect(await switcherIn(view)).toBe("webappwiz");
		await goTo(view, "Creds");
		expect(await switcherIn(view)).toBe("webappwiz");
	});

	it("leaves the switcher off a page that shows every project", async () => {
		const view = await testing.open();
		await goTo(view, "Tasks");

		const bar = await barOf(view);
		expect(
			within(bar).queryByRole("button", { name: /^Switch project/ }),
		).toBeNull();
	});

	it("stays on the page picked from, whatever page the other project was left on", async () => {
		rememberPlace("shop", { hash: "#tasks" });
		const view = await testing.open();
		await goTo(view, "Creds");

		await pickInBar(view, "/code/shop");

		const there = new URL(String(testing.visited[0]));
		expect(there.search).toBe("?project=shop");
		expect(there.hash).toBe("#creds");
	});

	it("goes to the top of the page, off the last project's system", async () => {
		const view = await testing.open();
		await goTo(view, "Systems");
		history.replaceState(null, "", "#systems/web");

		await pickInBar(view, "/code/shop");

		expect(new URL(String(testing.visited[0])).hash).toBe("#systems");
	});

	it("counts nothing beside the sidebar's Todos and Tasks", async () => {
		const view = await testing.open({
			todos: [todo(), todo({ id: 2 })],
			tasks: [details()],
		});

		expect([
			view.getByRole("tab", { name: /Todos/ }).textContent,
			view.getByRole("tab", { name: /Tasks/ }).textContent,
		]).toEqual(["Todos", "Tasks"]);
	});

	it("heads a phone's page with the switcher too, and counts nothing in the drawer", async () => {
		resize(390, 844);
		const view = await testing.open({
			repo: "webappwiz",
			todos: [todo()],
			tasks: [details()],
		});

		const drawer = await openDrawer(view);
		expect([
			within(drawer).getByRole("button", { name: "Todos" }).textContent,
			within(drawer).getByRole("button", { name: "Tasks" }).textContent,
		]).toEqual(["Todos", "Tasks"]);
		await act(async () =>
			fireEvent.click(within(drawer).getByRole("button", { name: "Creds" })),
		);

		const bar = await barOf(view);
		expect(within(bar).getByRole("heading", { name: "Creds" })).toBeTruthy();
		expect(
			within(bar).getByRole("button", { name: /^Switch project/ }),
		).toBeTruthy();
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

/** What the switcher in the page's bar names. */
async function switcherIn(view: ReturnType<typeof within>): Promise<string> {
	const bar = await barOf(view);
	return (
		within(bar).getByRole("button", { name: /^Switch project/ }).textContent ??
		""
	);
}

/** Opens the switcher in the page's bar and picks the project at `root`. */
async function pickInBar(
	view: ReturnType<typeof within>,
	root: string,
): Promise<void> {
	const bar = await barOf(view);
	await act(async () =>
		fireEvent.click(
			within(bar).getByRole("button", { name: /^Switch project/ }),
		),
	);
	const project = await waitFor(() => view.getByText(root));
	await act(async () => fireEvent.click(project));
}
