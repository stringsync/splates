import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's list actions on a conversation, shown before the server says so", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/** The sidebar's rows, by what each says. */
	function rows(nav: HTMLElement): (string | null)[] {
		return within(nav)
			.getAllByRole("listitem")
			.map((item) => item.textContent);
	}

	it("pins at once, and unpins again when the server refuses", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					title: "Old",
					createdAt: "2026-10-11T10:01:00.000Z",
				}),
				conversation({
					id: "c2",
					title: "New",
					createdAt: "2026-10-11T10:02:00.000Z",
				}),
			],
			null,
			{ tasks: [] },
		);
		const nav = view.getByRole("navigation", { name: "conversations" });
		testing.holdWrites();

		await act(async () =>
			fireEvent.click(within(nav).getByRole("button", { name: "Pin Old" })),
		);
		expect(rows(nav)).toEqual(["Old", "New"]);
		expect(within(nav).getByLabelText("Pinned")).toBeTruthy();

		testing.refuseWrites = { reason: "usage", message: "locked" };
		await act(async () => testing.release());
		await waitFor(() => expect(rows(nav)[0]).toBe("New"));
		expect(within(nav).getByRole("alert").textContent).toBe(
			"Not pinned: locked",
		);
	});

	it("hides an archived row and goes on at the click, and brings it back with why when refused", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Done", status: "stopped" }),
			conversation({ id: "c2", title: "Broke", status: "failed" }),
		]);
		const nav = view.getByRole("navigation", { name: "conversations" });
		testing.holdWrites();

		await act(async () =>
			fireEvent.click(
				within(nav).getByRole("button", { name: "Archive Done" }),
			),
		);
		expect(
			within(nav).queryByRole("button", { name: "More for Done" }),
		).toBeNull();
		await waitFor(() => expect(location.hash).toBe("#conversations/c2"));

		testing.refuseWrites = { reason: "usage", message: "locked" };
		await act(async () => testing.release());
		await waitFor(() =>
			expect(within(nav).getByRole("alert").textContent).toBe(
				"Not archived: locked",
			),
		);
		expect(
			within(nav).getByRole("button", { name: "More for Done" }),
		).toBeTruthy();
	});

	it("removes the task before archiving, both behind the row already gone", async () => {
		const view = await testing.openConversations(
			[
				conversation({ id: "c1", task: "alpha", status: "stopped" }),
				conversation({ id: "c2", title: "Other", status: "stopped" }),
			],
			"c2",
			{ tasks: [details({ task: "alpha", takenBy: "c1" })] },
		);
		const nav = view.getByRole("navigation", { name: "conversations" });
		testing.holdWrites();
		await act(async () =>
			fireEvent.click(
				within(nav).getByRole("button", { name: "Archive alpha" }),
			),
		);
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("dialog", { name: "Archive alpha?" })).getByRole(
					"button",
					{ name: "Archive" },
				),
			),
		);

		expect(
			within(nav).queryByRole("button", { name: "Archive alpha" }),
		).toBeNull();
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([]);
		await act(async () => testing.release());
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/archived")).toEqual([
				{ method: "PUT", body: { archived: true } },
			]),
		);
	});

	it("marks unread and renames at once", async () => {
		const view = await testing.openConversations(
			[
				conversation({ id: "c1", title: "Open" }),
				conversation({ id: "c2", title: "Fix footer" }),
			],
			"c1",
		);
		const nav = view.getByRole("navigation", { name: "conversations" });
		testing.holdWrites();

		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "More for Fix footer" }),
			),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					view.getByRole("menuitem", { name: "Mark as unread" }),
				),
			),
		);
		expect(within(nav).getByRole("status", { name: "unread" })).toBeTruthy();

		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "More for Fix footer" }),
			),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("menuitem", { name: "Rename" })),
			),
		);
		const box = within(nav).getByRole("textbox", { name: "Rename Fix footer" });
		await act(async () =>
			fireEvent.change(box, { target: { value: "  Footer  " } }),
		);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
		expect(
			within(nav).getByRole("button", { name: "More for Footer" }),
		).toBeTruthy();
	});

	it("shows the one opened read at once", async () => {
		testing.holdWrites();
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Fix login", unread: true })],
			"c1",
		);

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/unread")).toEqual([
				{ method: "PUT", body: { unread: false } },
			]),
		);
		expect(
			within(
				view.getByRole("navigation", { name: "conversations" }),
			).queryByRole("status", { name: "unread" }),
		).toBeNull();
	});
});
