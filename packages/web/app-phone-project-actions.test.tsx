import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	message,
	resize,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("Inbox actions across projects", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		resize(390, 844);
		testing.everywhere = [
			{
				project: "zebra",
				repo: "zebra",
				root: "/code/zebra",
				trunk: "main",
				worktreeRoot: "/code/worktrees",
				laneNames: [],
				lanesTaken: {},
				tasks: [
					details({ task: "alpha", takenBy: "c1", unmerged: true, ahead: 2 }),
				],
				conversations: [
					conversation({
						id: "c1",
						name: "Other project",
						task: "alpha",
						status: "running",
						messages: [
							{
								...message("agent", "Working"),
								at: "2020-01-01T00:00:00.000Z",
							},
						],
					}),
					conversation({ id: "z2", name: "Other parent", status: "stopped" }),
				],
			},
		];
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		resize(1024, 768);
	});

	const open = async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					name: "Current project",
					task: "alpha",
					status: "stopped",
				}),
			],
			null,
			{ tasks: [details({ task: "alpha", takenBy: "c1" })] },
		);
		const inbox = view.getByRole("region", { name: "inbox" });
		const folder = await waitFor(() =>
			within(inbox).getByRole("region", { name: "zebra" }),
		);
		const row = within(folder).getByRole("button", { name: /Other project/ });
		const button = within(row.parentElement as HTMLElement).getByRole(
			"button",
			{ name: "Conversation actions" },
		);
		await act(async () => fireEvent.click(button));
		return {
			view,
			inbox,
			folder,
			button,
			sheet: view.getByRole("dialog", { name: "Other project" }),
		};
	};

	it("offers a menu on every project's rows and renames within the owning project without navigating", async () => {
		const { view, inbox, sheet } = await open();
		expect(
			within(inbox).getAllByRole("button", {
				name: "Conversation actions",
				hidden: true,
			}),
		).toHaveLength(3);
		await act(async () =>
			fireEvent.click(within(sheet).getByRole("button", { name: "Rename" })),
		);
		await act(async () =>
			fireEvent.change(
				within(sheet).getByRole("textbox", { name: "Rename Other project" }),
				{ target: { value: "Renamed elsewhere" } },
			),
		);
		await act(async () =>
			fireEvent.click(within(sheet).getByRole("button", { name: "Save" })),
		);
		expect(testing.posted("/api/conversations/c1/name?project=zebra")).toEqual([
			{ method: "PUT", body: { name: "Renamed elsewhere" } },
		]);
		expect(testing.posted("/api/conversations/c1/name")).toEqual([]);
		expect(view.getByRole("button", { name: /Current project/ })).toBeTruthy();
		expect(testing.visited).toEqual([]);
	});

	it.each([
		["Pin", "pinned", { pinned: true }],
		["Mark as unread", "unread", { unread: true }],
	] as const)(
		"sends %s to the owning project and leaves the selected project alone",
		async (action, path, body) => {
			const { sheet, button, view } = await open();
			testing.holdWrites();
			await act(async () =>
				fireEvent.click(within(sheet).getByRole("button", { name: action })),
			);
			expect(
				testing.posted(`/api/conversations/c1/${path}?project=zebra`),
			).toEqual([{ method: "PUT", body }]);
			expect(testing.posted(`/api/conversations/c1/${path}`)).toEqual([]);
			expect(button.getAttribute("disabled")).not.toBeNull();
			const current = view.getByRole("button", { name: /Current project/ });
			expect(
				within(current.parentElement as HTMLElement)
					.getByRole("button", { name: "Conversation actions" })
					.getAttribute("disabled"),
			).toBeNull();
			await act(async () => testing.release());
			expect(button.getAttribute("disabled")).toBeNull();
		},
	);

	it("moves a foreign conversation only among its own project's conversations", async () => {
		const { sheet, view } = await open();
		await act(async () =>
			fireEvent.click(
				within(sheet).getByRole("button", { name: "Move under…" }),
			),
		);
		const move = view.getByRole("dialog", { name: "Move Other project under" });
		expect(
			within(move).queryByRole("button", { name: /Current project/ }),
		).toBeNull();
		await act(async () =>
			fireEvent.click(
				within(move).getByRole("button", { name: /Other parent/ }),
			),
		);
		expect(
			testing.posted("/api/conversations/c1/parent?project=zebra"),
		).toEqual([{ method: "PUT", body: { parent: "z2" } }]);
	});

	it("confirms archive against the owning project's task and removes only that project's work", async () => {
		const { sheet, view } = await open();
		await act(async () =>
			fireEvent.click(within(sheet).getByRole("button", { name: "Archive" })),
		);
		const confirm = view.getByRole("dialog", {
			name: "Archive Other project?",
		});
		expect(confirm.textContent).toContain("2 commits not on main");
		expect(
			testing.posted("/api/conversations/c1/archived?project=zebra"),
		).toEqual([]);
		await act(async () =>
			fireEvent.click(within(confirm).getByRole("button", { name: "Archive" })),
		);
		expect(testing.posted("/api/tasks/alpha?project=zebra")).toEqual([
			{ method: "DELETE", body: {} },
		]);
		expect(
			testing.posted("/api/conversations/c1/archived?project=zebra"),
		).toEqual([{ method: "PUT", body: { archived: true } }]);
		expect(testing.posted("/api/tasks/alpha")).toEqual([]);
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([]);
	});

	it("stops a quiet turn in its own project", async () => {
		const { sheet } = await open();
		await act(async () =>
			fireEvent.click(within(sheet).getByRole("button", { name: "Stop turn" })),
		);
		expect(
			testing.posted("/api/conversations/c1/cancel?project=zebra"),
		).toEqual([{ method: "POST", body: {} }]);
		expect(testing.posted("/api/conversations/c1/cancel")).toEqual([]);
	});
});
