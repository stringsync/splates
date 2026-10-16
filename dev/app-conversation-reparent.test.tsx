import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	resize,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's moving a conversation under another", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		resize(1024, 768);
	});

	// alpha-api is a part of alpha, so nests under it by its task.
	const open = () =>
		testing.openConversations(
			[
				conversation({ id: "c1", title: "Alpha", task: "alpha" }),
				conversation({ id: "c2", title: "Alpha API", task: "alpha-api" }),
				conversation({ id: "c3", title: "Footer" }),
			],
			null,
			{
				tasks: [
					details({ task: "alpha" }),
					details({ task: "alpha-api", base: "task/alpha" }),
				],
			},
		);

	it("offers every other conversation but its own parts, the one it sits under checked", async () => {
		const view = await open();
		const nav = view.getByRole("navigation", { name: "conversations" });

		await act(async () =>
			fireEvent.click(
				within(nav).getByRole("button", { name: "More for alpha" }),
			),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					view.getByRole("menuitem", { name: "Move under…" }),
				),
			),
		);
		const places = within(
			await waitFor(() => view.getByRole("dialog", { name: /Move alpha / })),
		).getByRole("list", { name: "Places" });

		expect(
			within(places)
				.getAllByRole("button")
				.map((each) => [
					each.textContent,
					each.getAttribute("aria-current") === "true",
				]),
		).toEqual([
			["Nothing: at the top", true],
			["Footer", false],
		]);
	});

	it("moves a part to the top", async () => {
		const view = await open();
		const nav = view.getByRole("navigation", { name: "conversations" });

		await act(async () =>
			fireEvent.click(
				within(nav).getByRole("button", { name: "More for alpha-api" }),
			),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					view.getByRole("menuitem", { name: "Move under…" }),
				),
			),
		);
		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: /Move alpha-api/ }),
		);
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Nothing: at the top" }),
			),
		);

		expect(testing.posted("/api/conversations/c2/parent")).toEqual([
			{ method: "PUT", body: { parent: null } },
		]);
	});

	it("nests one where the person put it, over where its task would", async () => {
		const view = await testing.openConversations(
			[
				conversation({ id: "c1", title: "Alpha", task: "alpha" }),
				conversation({
					id: "c2",
					title: "Alpha API",
					task: "alpha-api",
					parent: { id: null },
				}),
				conversation({
					id: "c3",
					title: "Footer",
					parent: { id: "c1" },
				}),
			],
			null,
			{
				tasks: [
					details({ task: "alpha" }),
					details({ task: "alpha-api", base: "task/alpha" }),
				],
			},
		);

		const parts = view.getByRole("list", { name: "parts of alpha" });
		expect(
			within(parts)
				.getAllByRole("listitem")
				.map((each) => each.textContent),
		).toEqual(["Footer"]);
	});

	it("moves one from a long press on its inbox row", async () => {
		resize(390, 844);
		const view = await open();
		const inbox = view.getByRole("region", { name: "inbox" });
		const row = within(inbox).getByRole("button", { name: /Footer/ });
		await act(async () => {
			fireEvent.pointerDown(row);
			fireEvent.contextMenu(row);
		});

		await act(async () =>
			fireEvent.click(
				within(view.getByRole("dialog", { name: "Footer" })).getByRole(
					"button",
					{ name: "Move under…" },
				),
			),
		);
		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: /Move Footer/ }),
		);
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: /alpha$/ })),
		);

		expect(testing.posted("/api/conversations/c3/parent")).toEqual([
			{ method: "PUT", body: { parent: "c1" } },
		]);
	});
});
