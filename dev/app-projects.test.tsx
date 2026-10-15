import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, cleanup, fireEvent, Testing, waitFor, within } from "./testing";

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
		expect(view.queryByText("/code/webappwiz")).toBeNull();
		await act(async () => fireEvent.keyDown(find, { key: "Enter" }));

		expect(testing.visited).toHaveLength(1);
		expect(new URL(String(testing.visited[0])).search).toBe("?project=shop");
	});

	it("lists this machine's arbor dev and its slots, and opens the one picked", async () => {
		testing.servers = [
			{ slot: null, url: "https://arbor.example.com", tree: null, here: true },
			{
				slot: { word: "fox", emoji: "🦊" },
				url: "https://fox.example.com",
				tree: "/code/webappwiz-arbor/upload",
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
			{ slot: null, url: "https://arbor.example.com", tree: null, here: true },
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

	it("forgets a project that is gone", async () => {
		const view = await testing.open();
		await openSwitcher(view);

		const forget = await waitFor(() =>
			view.getByRole("button", { name: "Forget old" }),
		);
		await act(async () => fireEvent.click(forget));

		expect(testing.posts).toContainEqual(
			expect.objectContaining({ path: "/api/projects/old", method: "DELETE" }),
		);
	});

	it("forgets one still there, focused or not, but never the one shown", async () => {
		visit("http://localhost/?project=old");
		const view = await testing.open();
		await openSwitcher(view);

		const forget = await waitFor(() =>
			view.getByRole("button", { name: "Forget shop" }),
		);
		expect(view.getByRole("button", { name: "Forget webappwiz" })).toBeTruthy();
		expect(view.queryByRole("button", { name: "Forget old" })).toBeNull();
		await act(async () => fireEvent.click(forget));

		expect(testing.posts).toContainEqual(
			expect.objectContaining({ path: "/api/projects/shop", method: "DELETE" }),
		);
	});

	it("focuses the project picked, and names it in the address", async () => {
		const view = await testing.open();
		await openSwitcher(view);

		await act(async () =>
			fireEvent.click(await waitFor(() => view.getByText("/code/shop"))),
		);

		expect(testing.posts).toContainEqual(
			expect.objectContaining({
				path: expect.stringMatching(/^\/api\/focus/),
				method: "PUT",
				body: JSON.stringify({ project: "shop" }),
			}),
		);
		expect(new URL(String(testing.visited[0])).search).toBe("?project=shop");
	});

	it("adds a project by its path, and asks before committing what arbor init wrote", async () => {
		testing.reply = {
			project: { slug: "fresh", root: "/code/fresh", added: "", gone: false },
			uncommitted: [".agents/skills/arbor/SKILL.md", "skills-lock.json"],
			shown: [".agents/skills/arbor", "skills-lock.json"],
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
				name: "Commit what arbor init wrote in fresh",
			}),
		);
		expect(asking.textContent).toContain(
			"arbor init wrote .agents/skills/arbor, skills-lock.json in fresh. Commit them on main?",
		);
		expect(testing.visited).toEqual([]);

		await act(async () =>
			fireEvent.click(within(asking).getByRole("button", { name: "Commit" })),
		);
		expect(testing.posts).toContainEqual(
			expect.objectContaining({
				path: expect.stringMatching(/^\/api\/projects\/fresh\/commit/),
				body: JSON.stringify({
					paths: [".agents/skills/arbor/SKILL.md", "skills-lock.json"],
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
				name: "Commit what arbor init wrote in fresh",
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
		testing.refuse("not_found", "no arbor project yet: add one by its path");
		const view = testing.render();

		await waitFor(() =>
			expect(
				view.getByText("No arbor project yet: add one by its path"),
			).toBeTruthy(),
		);
		expect(view.getByRole("form", { name: "Add a project" })).toBeTruthy();
	});
});

/** Clicks the project switcher open in `view`. */
async function openSwitcher(view: ReturnType<typeof within>): Promise<void> {
	await act(async () =>
		fireEvent.click(view.getByRole("button", { name: /^Switch project/ })),
	);
}
