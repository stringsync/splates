import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { AGENTS } from "./fixtures";
import {
	cleanup,
	conversation,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

describe("App drawn from its last copy", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("draws the board it last showed before the server answers, then what the server says", async () => {
		await testing.open({ todos: [todo({ id: 1, subject: "Kept" })] });
		cleanup();
		const arrive = testing.holdSnapshots();

		const view = testing.render({ todos: [todo({ id: 1, subject: "Fresh" })] });

		await waitFor(() => view.getByText("Kept"));
		expect(view.getByRole("status", { name: "Refreshing" })).toBeDefined();
		arrive();
		await waitFor(() => view.getByText("Fresh"));
		expect(view.queryByText("Kept")).toBeNull();
		await waitFor(() =>
			expect(view.queryByRole("status", { name: "Refreshing" })).toBeNull(),
		);
	});

	it("keeps cached inbox rows interactive while the server answers", async () => {
		await testing.openConversations(
			[conversation({ id: "c1", title: "Fix login" })],
			null,
		);
		cleanup();
		testing.talk = {
			agents: AGENTS,
			conversations: [conversation({ id: "c1", title: "Fix signup" })],
		};
		const arrive = testing.holdSnapshots();

		const view = testing.render();

		const list = await waitFor(() =>
			view.getByRole("navigation", { name: "conversations" }),
		);
		const row = await waitFor(() => within(list).getByText("Fix signup"));
		expect(row.closest("[inert]")).toBeNull();
		arrive();
		await waitFor(() =>
			expect(
				within(list).getByText("Fix signup").closest("[inert]"),
			).toBeNull(),
		);
		expect(within(list).queryByText("Fix login")).toBeNull();
	});

	it("draws the conversations it last listed once the server answers, while it cannot list them", async () => {
		await testing.openConversations(
			[conversation({ id: "c1", title: "Fix login" })],
			null,
		);
		cleanup();
		testing.talk = null;
		const arrive = testing.holdSnapshots();

		const view = testing.render();
		arrive();

		await waitFor(() =>
			within(view.getByRole("navigation", { name: "conversations" })).getByText(
				"Fix login",
			),
		);
	});

	it("waits for the server when it kept nothing", async () => {
		const arrive = testing.holdSnapshots();

		const view = testing.render({ todos: [todo({ id: 1, subject: "Fresh" })] });

		await Bun.sleep(10);
		expect(view.queryByText("Fresh")).toBeNull();
		arrive();
		await waitFor(() => view.getByText("Fresh"));
	});
});
