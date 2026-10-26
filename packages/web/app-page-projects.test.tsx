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

	it("heads only the project's own pages' bars with its switcher", async () => {
		const view = await testing.open({ repo: "webappwiz" });

		const switchers = [
			await switcherOn(view, "Board"),
			await switcherOn(view, "Queue"),
			await switcherOn(view, "Billing"),
			await switcherOn(view, "Creds"),
		];
		expect(switchers).toEqual(["webappwiz", null, null, "webappwiz"]);
	});

	it("names the server atop the sidebar, the project heading its own pages", async () => {
		const view = await testing.open({ repo: "webappwiz" });
		await goTo(view, "Stats");

		const tabs = view.getByRole("tablist");
		expect([
			view.getByRole("heading", { level: 1 }).textContent,
			within(tabs).getByRole("button", { name: /^Switch project/ }).textContent,
			within(tabs)
				.getAllByRole("tab")
				.map((each) => each.textContent),
		]).toEqual([
			"Spinning Plates",
			"webappwiz",
			[
				"Board",
				"Creds",
				"Automations",
				"Queue",
				"Stats",
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

	it("heads a phone's drawer with the server, the project heading its own pages", async () => {
		resize(390, 844);
		const view = await testing.open({
			repo: "webappwiz",
			todos: [todo()],
			tasks: [details()],
		});

		const drawer = await openDrawer(view);
		expect([
			within(drawer).getByRole("heading", { level: 1 }).textContent,
			within(drawer).getByRole("button", { name: /^Switch project/ })
				.textContent,
			within(drawer).getByRole("button", { name: "Board" }).textContent,
			within(drawer).getByRole("button", { name: "Queue" }).textContent,
		]).toEqual(["Spinning Plates", "webappwiz", "Board", "Queue"]);
		await act(async () =>
			fireEvent.click(within(drawer).getByRole("button", { name: "Creds" })),
		);

		const bar = await barOf(view);
		expect([
			within(bar).getByRole("heading", { name: "Creds" }).textContent,
			within(bar).getByRole("button", { name: /^Switch project/ }).textContent,
		]).toEqual(["Creds", "webappwiz"]);
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
