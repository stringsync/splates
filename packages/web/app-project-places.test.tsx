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
		await pick(back, "/code/webappwiz");

		const returned = new URL(String(testing.visited[1]));
		expect(returned.search).toBe("?project=webappwiz");
		expect(returned.hash).toBe("#creds");
	});

	it("comes back to the page it left a project on through another project's task", async () => {
		visit("http://localhost/?project=webappwiz");
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

		await pick(within(document.body), "/code/webappwiz");

		expect(location.search).toBe("?project=webappwiz");
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
		fireEvent.click(
			view.getAllByRole("button", {
				name: /^Switch project/,
			})[0] as HTMLElement,
		),
	);
	const project = await waitFor(() => view.getByText(root));
	await act(async () => fireEvent.click(project));
}
