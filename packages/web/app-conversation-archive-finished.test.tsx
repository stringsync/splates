import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	newestFirst,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's archiving finished conversations together", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("offers to archive those whose task ended, not a plain conversation, and archives only those left ticked", async () => {
		const view = await testing.openConversations(
			newestFirst([
				conversation({
					id: "c1",
					title: "Landed",
					lastTask: "header",
					messages: [
						message("agent", "## ✅ Merged header onto main\n\nIt wraps."),
					],
				}),
				conversation({
					id: "c2",
					title: "Dropped",
					lastTask: "footer",
					messages: [
						message("agent", "## 🧹 Removed footer: superseded\n\nMoved."),
					],
				}),
				conversation({
					id: "c4",
					title: "Shipped",
					lastTask: "nav",
					messages: [
						message("agent", "## ✅ Merged nav onto main\n\nIt fits."),
					],
				}),
				conversation({
					id: "c3",
					title: "Just talking",
					messages: [message("agent", "## ✅ Done: answered\n\nIt is so.")],
				}),
			]),
			null,
		);
		const line = view.getByRole("button", { name: "Archive 3 finished" });
		await act(async () => fireEvent.click(line));
		const dialog = within(await view.findByRole("dialog"));
		expect(dialog.queryByText("Just talking")).toBeNull();
		await act(async () => fireEvent.click(dialog.getByText("footer")));
		await act(async () =>
			fireEvent.click(dialog.getByRole("button", { name: "Archive 2" })),
		);
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/archived")).toEqual([
				{ method: "PUT", body: { archived: true } },
			]),
		);
		expect(testing.posted("/api/conversations/c2/archived")).toEqual([]);
		expect(testing.posted("/api/conversations/c3/archived")).toEqual([]);
	});

	it("offers nothing for fewer than three finished conversations", async () => {
		const view = await testing.openConversations(
			newestFirst([
				conversation({
					id: "c1",
					title: "Landed",
					lastTask: "header",
					messages: [
						message("agent", "## ✅ Merged header onto main\n\nIt wraps."),
					],
				}),
				conversation({
					id: "c2",
					title: "Dropped",
					lastTask: "footer",
					messages: [
						message("agent", "## 🧹 Removed footer: superseded\n\nMoved."),
					],
				}),
			]),
			null,
		);
		expect(view.queryByRole("button", { name: /finished/ })).toBeNull();
	});
});
