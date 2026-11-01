import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	details,
	fireEvent,
	openQueueRow,
	queueRow,
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

describe("App coming back to a project", () => {
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
				waiting: 2,
				ships: false,
			},
		];
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		visit("about:blank");
		sessionStorage.clear();
	});

	it("comes back to the page it left a project on", async () => {
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Creds/ })),
		);
		await waitFor(() => expect(location.hash).toBe("#creds"));
		await pick(view, "/code/shop");
		const there = new URL(String(testing.visited[0]));
		expect(there.search).toBe("?project=shop");
		expect(there.hash).toBe("#creds");
		cleanup();

		visit(there.toString());
		const back = await testing.open();
		await act(async () =>
			fireEvent.click(back.getByRole("tab", { name: /Creds/ })),
		);
		await waitFor(() => expect(location.hash).toBe("#creds"));
		await pick(back, "/code/wren");

		const returned = new URL(String(testing.visited[1]));
		expect(returned.search).toBe("?project=wren");
		expect(returned.hash).toBe("#creds");
	});

	it("comes back to the page it left a project on through another project's task", async () => {
		visit("http://localhost/?project=wren");
		testing.everywhere = [
			{
				project: "shop",
				repo: "shop",
				root: "/code/shop",
				worktreeRoot: "/code/worktrees",
				trunk: "main",
				tasks: [details({ task: "checkout" })],
				laneNames: [],
				lanesTaken: {},
				conversations: [],
			},
		];
		const view = await testing.openTasks();
		await waitFor(() => queueRow(view, "checkout"));
		await openQueueRow(view, "checkout");
		await waitFor(() => expect(location.hash).toBe("#tasks/checkout"));

		await pick(within(document.body), "/code/wren");

		expect(location.search).toBe("?project=wren");
		expect(location.hash).toBe("#tasks");
	});

	it("stays on a project-scoped page over where the project was left", async () => {
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Creds/ })),
		);
		await waitFor(() => expect(location.hash).toBe("#creds"));
		sessionStorage.setItem(
			"splates.places",
			JSON.stringify({ shop: { hash: "#conversations" } }),
		);
		await pick(view, "/code/shop");
		const there = new URL(String(testing.visited[0]));
		expect(there.search).toBe("?project=shop");
		expect(there.hash).toBe("#creds");
	});

	// vet-ignore simple-test-setup: older than this task, which only gave its projects the ships field
	it("names the project started in while it opens again", async () => {
		await testing.open({ repo: "wren" });
		cleanup();

		const arrive = testing.holdSnapshots();

		const opening = testing.open();
		const screen = within(document.body);
		await waitFor(() => screen.getByText("Opening wren"));
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
		fireEvent.click(
			view.getAllByRole("button", {
				name: /^Switch project/,
			})[0] as HTMLElement,
		),
	);
	const project = await waitFor(() => view.getByText(root));
	await act(async () => fireEvent.click(project));
}
