import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { EverywhereProject } from "@stringsync/splates-server/projects";
import type { Details } from "@stringsync/splates-server/tasks";
import {
	act,
	cleanup,
	clickShown,
	details,
	fireEvent,
	queueRow,
	snapshot,
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

describe("App's projects", () => {
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
			{
				slug: "old",
				root: "/code/old",
				gone: true,
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
	});

	it("opens the switcher on ⌃⌘P, narrows it as you type, and goes to the pick on Enter", async () => {
		const view = await testing.open();

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
		const projects = view.getByRole("list", { name: "projects" });
		expect(within(projects).queryByText("/code/webappwiz")).toBeNull();
		await act(async () => fireEvent.keyDown(find, { key: "Enter" }));

		expect(testing.visited).toHaveLength(1);
		expect(new URL(String(testing.visited[0])).search).toBe("?project=shop");
	});

	it("opens the pick in place, naming it until its snapshot arrives, with nothing of the last one on it", async () => {
		testing.talk = { agents: [], conversations: [] };
		const view = await testing.open({
			repo: "webappwiz",
			todos: [todo({ id: 1, subject: "webappwiz's own" })],
		});
		await waitFor(() => view.getByText("webappwiz's own"));
		await waitFor(() => expect(testing.talkStream).not.toBeNull());
		const left = { events: testing.stream, talk: testing.talkStream };
		const arrive = testing.holdSnapshots();
		testing.served = snapshot({
			repo: "shop",
			todos: [todo({ id: 2, subject: "shop's own" })],
		});

		await pick(view, "/code/shop");

		expect(location.search).toBe("?project=shop");
		const screen = within(document.body);
		expect(
			(await waitFor(() => screen.getByText("Opening shop"))).getAttribute(
				"role",
			),
		).toBe("status");
		expect(screen.queryByText("webappwiz's own")).toBeNull();
		expect(left.events?.closed).toBe(true);
		expect(left.talk?.closed).toBe(true);
		arrive();
		await waitFor(() => screen.getByText("shop's own"));
		expect(testing.asked).toContain("/api/snapshot?project=shop");
		expect(testing.reloads).toBe(0);
	});

	it("draws a project not shown before at once, from every project's tasks, while its snapshot is on its way", async () => {
		testing.everywhere = [
			listed("shop", "/code/shop", [details({ task: "checkout" })]),
		];
		const view = await testing.openTasks({ repo: "webappwiz" });
		await waitFor(() => queueRow(view, "checkout"));
		const arrive = testing.holdSnapshots();

		await pick(view, "/code/shop");

		await waitFor(() => expect(location.search).toBe("?project=shop"));
		const screen = within(document.body);
		expect(screen.queryByText("Opening shop")).toBeNull();
		expect(
			screen.getAllByText("🍽️").map((each) => each.getAttribute("aria-hidden")),
		).not.toContain("true");
		expect(queueRow(screen, "checkout")).toBeTruthy();
		arrive();
	});

	it("draws a project shown before at once on a return, as it last held it, while its snapshot is on its way", async () => {
		testing.everywhere = [
			listed("webappwiz", "/repo", []),
			listed("shop", "/code/shop", []),
		];
		// On, so the page's list of every project's conversations reads them.
		testing.talk = { agents: [], conversations: [] };
		const view = await testing.open({
			repo: "webappwiz",
			todos: [todo({ id: 1, subject: "webappwiz's own" })],
		});
		await waitFor(() => view.getByText("webappwiz's own"));
		testing.served = snapshot({ repo: "shop" });
		await pick(view, "/code/shop");
		const screen = within(document.body);
		await waitFor(() =>
			expect(screen.queryByText("webappwiz's own")).toBeNull(),
		);
		const arrive = testing.holdSnapshots();

		await pick(screen, "/code/webappwiz");

		await waitFor(() => expect(location.search).toBe("?project=webappwiz"));
		expect(screen.getByText("webappwiz's own")).toBeTruthy();
		expect(screen.queryByText("Opening webappwiz")).toBeNull();
		arrive();
	});

	it("goes back to the project left on the browser's back", async () => {
		const view = await testing.open({ repo: "webappwiz" });
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Creds/ })),
		);
		await waitFor(() => expect(location.hash).toBe("#creds"));
		testing.served = snapshot({ repo: "shop" });
		await pick(view, "/code/shop");
		const screen = within(document.body);
		await waitFor(() =>
			expect(
				screen.getAllByRole("button", { name: /^Switch project/ })[0]
					?.textContent,
			).toBe("shop"),
		);
		testing.served = snapshot({ repo: "webappwiz" });

		await act(async () => history.back());

		await waitFor(() => expect(location.search).toBe(""));
		await waitFor(() =>
			expect(
				screen.getAllByRole("button", { name: /^Switch project/ })[0]
					?.textContent,
			).toBe("webappwiz"),
		);
	});

	it("lists this machine's splates server and its slots, and opens the one picked", async () => {
		testing.servers = [
			{
				slot: null,
				url: "https://splates.example.com",
				tree: null,
				here: true,
			},
			{
				slot: { word: "fox", emoji: "🦊" },
				url: "https://fox.example.com",
				tree: "/code/webappwiz-splates/upload",
				here: false,
			},
		];
		const view = await testing.open();

		await act(async () =>
			fireEvent.keyDown(window, {
				key: "p",
				code: "KeyP",
				ctrlKey: true,
				metaKey: true,
			}),
		);
		const slots = await waitFor(() =>
			view.getByRole("list", { name: "slots" }),
		);
		expect(within(slots).getByText("this machine")).toBeTruthy();
		const find = view.getByRole("textbox", { name: "find a project" });
		await act(async () =>
			fireEvent.change(find, { target: { value: "upload" } }),
		);
		expect(view.queryByText("/code/shop")).toBeNull();
		expect(within(slots).queryByText("this machine")).toBeNull();
		await act(async () => fireEvent.keyDown(find, { key: "Enter" }));

		expect(testing.visited).toEqual(["https://fox.example.com"]);
	});

	it("lists no slots on a machine that runs none", async () => {
		testing.servers = [
			{
				slot: null,
				url: "https://splates.example.com",
				tree: null,
				here: true,
			},
		];
		const view = await testing.open();

		await act(async () =>
			fireEvent.keyDown(window, {
				key: "p",
				code: "KeyP",
				ctrlKey: true,
				metaKey: true,
			}),
		);
		await waitFor(() => expect(view.getByText("/code/shop")).toBeTruthy());
		expect(view.queryByRole("list", { name: "slots" })).toBeNull();
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

	it("opens each project still there in the editor the settings pick", async () => {
		localStorage.setItem(
			"splates.settings",
			JSON.stringify({ "editor.opener": "cursor" }),
		);
		const view = await testing.open();
		await openSwitcher(view);

		await openMenu(view, "shop");
		const shop = await waitFor(() =>
			view.getByRole("menuitem", { name: "Open in Cursor" }),
		);
		expect(shop.getAttribute("href")).toBe("cursor://file/code/shop");
		await act(async () => fireEvent.keyDown(shop, { key: "Escape" }));
		await openMenu(view, "old");
		await waitFor(() => view.getByRole("menuitem", { name: "Forget old" }));
		expect(view.queryByRole("menuitem", { name: "Open in Cursor" })).toBeNull();
		localStorage.clear();
	});

	it("forgets a project that is gone", async () => {
		const view = await testing.open();
		await openSwitcher(view);

		await openMenu(view, "old");
		const forget = await waitFor(() =>
			view.getByRole("menuitem", { name: "Forget old" }),
		);
		await act(async () => fireEvent.click(forget));

		expect(testing.posts).toContainEqual(
			expect.objectContaining({ path: "/api/projects/old", method: "DELETE" }),
		);
	});

	it("forgets one still there, focused or not, staying on the one shown", async () => {
		visit("http://localhost/?project=old");
		const view = await testing.open();
		await openSwitcher(view);

		expect(
			await waitFor(() =>
				view.getByRole("button", { name: "More for webappwiz" }),
			),
		).toBeTruthy();
		await openMenu(view, "shop");
		const forget = await waitFor(() =>
			view.getByRole("menuitem", { name: "Forget shop" }),
		);
		await act(async () => fireEvent.click(forget));

		expect(testing.posts).toContainEqual(
			expect.objectContaining({ path: "/api/projects/shop", method: "DELETE" }),
		);
		expect(testing.visited).toEqual([]);
	});

	it("forgets the one shown, going to the project focused before it", async () => {
		visit("http://localhost/?project=shop#todos");
		testing.reply = { slug: "shop", next: { slug: "webappwiz" } };
		const view = await testing.open();
		await openSwitcher(view);

		await openMenu(view, "shop");
		await clickShown(() => view.getByRole("menuitem", { name: "Forget shop" }));

		await waitFor(() =>
			expect(new URL(String(testing.visited[0])).search).toBe(
				"?project=webappwiz",
			),
		);
	});

	it("forgets the last project, going to the page that asks for one", async () => {
		visit("http://localhost/?project=shop#todos");
		testing.reply = { slug: "shop", next: null };
		const view = await testing.open();
		await openSwitcher(view);

		await openMenu(view, "shop");
		await clickShown(() => view.getByRole("menuitem", { name: "Forget shop" }));

		await waitFor(() =>
			expect(String(testing.visited[0])).toBe("http://localhost/"),
		);
	});

	it("focuses the project picked, and names it in the address", async () => {
		const view = await testing.open();
		await openSwitcher(view);

		await clickShown(() => view.getByText("/code/shop"));

		expect(testing.posts).toContainEqual(
			expect.objectContaining({
				path: expect.stringMatching(/^\/api\/focus/),
				method: "PUT",
				body: JSON.stringify({ project: "shop" }),
			}),
		);
		expect(new URL(String(testing.visited[0])).search).toBe("?project=shop");
	});

	it("adds a project by its path, and asks before committing what splates init wrote", async () => {
		testing.reply = {
			project: { slug: "fresh", root: "/code/fresh", added: "", gone: false },
			uncommitted: [".agents/skills/splates/SKILL.md", "skills-lock.json"],
			shown: [".agents/skills/splates", "skills-lock.json"],
			branch: "main",
		};
		const view = await testing.open();
		await openSwitcher(view);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Add a project" })),
		);
		await act(async () =>
			fireEvent.change(view.getByRole("textbox", { name: "project path" }), {
				target: { value: "~/code/fresh" },
			}),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Add" })),
		);

		expect(testing.posts).toContainEqual(
			expect.objectContaining({
				path: expect.stringMatching(/^\/api\/projects/),
				method: "POST",
				body: JSON.stringify({ path: "~/code/fresh" }),
			}),
		);
		const asking = await waitFor(() =>
			view.getByRole("group", {
				name: "Commit what splates init wrote in fresh",
			}),
		);
		expect(asking.textContent).toContain(
			"splates init wrote .agents/skills/splates, skills-lock.json in fresh. Commit them on main?",
		);
		expect(testing.visited).toEqual([]);

		await act(async () =>
			fireEvent.click(within(asking).getByRole("button", { name: "Commit" })),
		);
		expect(testing.posts).toContainEqual(
			expect.objectContaining({
				path: expect.stringMatching(/^\/api\/projects\/fresh\/commit/),
				body: JSON.stringify({
					paths: [".agents/skills/splates/SKILL.md", "skills-lock.json"],
				}),
			}),
		);
		await waitFor(() =>
			expect(new URL(String(testing.visited[0])).search).toBe("?project=fresh"),
		);
	});

	it("opens a project added without committing, when asked to leave it", async () => {
		testing.reply = {
			project: { slug: "fresh", root: "/code/fresh", added: "", gone: false },
			uncommitted: ["skills-lock.json"],
			shown: ["skills-lock.json"],
			branch: null,
		};
		const view = await testing.open();
		await openSwitcher(view);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Add a project" })),
		);
		await act(async () =>
			fireEvent.change(view.getByRole("textbox", { name: "project path" }), {
				target: { value: "/code/fresh" },
			}),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Add" })),
		);
		const asking = await waitFor(() =>
			view.getByRole("group", {
				name: "Commit what splates init wrote in fresh",
			}),
		);
		expect(asking.textContent).toContain("Commit it?");

		await act(async () =>
			fireEvent.click(
				within(asking).getByRole("button", { name: "Leave uncommitted" }),
			),
		);
		expect(testing.posts.some((post) => post.path.includes("/commit"))).toBe(
			false,
		);
		expect(new URL(String(testing.visited[0])).search).toBe("?project=fresh");
	});

	it("asks for a project when there is none to show", async () => {
		testing.projects = [];
		testing.refuse("not_found", "no splates project yet: add one by its path");
		const view = testing.render();

		await waitFor(() =>
			expect(
				view.getByText("No splates project yet: add one by its path"),
			).toBeTruthy(),
		);
		expect(view.getByRole("form", { name: "Add a project" })).toBeTruthy();
	});
});

/** Clicks the project switcher open in `view`. */
async function openSwitcher(view: ReturnType<typeof within>): Promise<void> {
	await act(async () =>
		fireEvent.click(
			view.getAllByRole("button", {
				name: /^Switch project/,
			})[0] as HTMLElement,
		),
	);
}

/** Opens the menu of the switcher's row for `slug`. */
async function openMenu(
	view: ReturnType<typeof within>,
	slug: string,
): Promise<void> {
	await clickShown(() =>
		view.getByRole("button", { name: `More for ${slug}` }),
	);
}

/** Opens the project switcher in `view` and picks the project at `root`. */
async function pick(
	view: ReturnType<typeof within>,
	root: string,
): Promise<void> {
	await openSwitcher(view);
	const project = await waitFor(() => view.getByText(root));
	await act(async () => fireEvent.click(project));
}

/** A project as `/api/everywhere` lists it, holding `tasks`. */
function listed(
	project: string,
	root: string,
	tasks: Details[],
): EverywhereProject {
	return {
		project,
		repo: project,
		root,
		worktreeRoot: "/code/worktrees",
		trunk: "main",
		tasks,
		laneNames: [],
		lanesTaken: {},
		conversations: [],
	};
}
