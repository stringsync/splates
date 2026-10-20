import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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
		arrive();
		await waitFor(() => view.getByText("Fresh"));
		expect(view.queryByText("Kept")).toBeNull();
	});

	it("draws the conversations it last listed while the server cannot list them", async () => {
		await testing.openConversations(
			[conversation({ id: "c1", title: "Fix login" })],
			null,
		);
		cleanup();
		testing.talk = null;
		testing.holdSnapshots();

		const view = testing.render();

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
