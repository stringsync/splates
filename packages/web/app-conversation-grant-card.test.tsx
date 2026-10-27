import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	waitFor,
} from "./testing";

describe("App's grant card", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const ask = message(
		"agent",
		"## 🔐 Permission: grant shop tasks to splates: run the cart lane\n\nIts lane holds ours up.",
	);

	it("grants from the page on Allow, then tells the agent so", async () => {
		const view = await testing.openConversations([
			conversation({ title: "Cart", messages: [ask] }),
		]);
		await waitFor(() =>
			expect(view.getByText(/run its queue and lanes/)).toBeTruthy(),
		);
		expect(view.getByText("Its lane holds ours up.")).toBeTruthy();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Allow" })),
		);
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "[SPLATES GRANTED]" } },
			]),
		);
		expect(
			testing.posts
				.filter((post) => post.path.startsWith("/api/projects/shop/grants"))
				.map((post) => [post.method, JSON.parse(String(post.body))]),
		).toEqual([["PUT", { from: "splates", reach: "tasks" }]]);
		expect(view.getByText("Granted splates tasks in shop")).toBeTruthy();
	});

	it("denies without granting, sending the note", async () => {
		const view = await testing.openConversations([
			conversation({ title: "Cart", messages: [ask] }),
		]);
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("button", { name: "Deny" })),
			),
		);
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "[SPLATES GRANT DENIED]" } },
			]),
		);
		expect(
			testing.posts.filter((post) => post.path.includes("/grants")),
		).toEqual([]);
		expect(view.getByText("Denied splates tasks in shop")).toBeTruthy();
	});

	it("takes Allow back, saying why, when the server refuses the grant", async () => {
		testing.refuseWrites = { reason: "not_found", message: "no project shop" };
		const view = await testing.openConversations([
			conversation({ title: "Cart", messages: [ask] }),
		]);
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("button", { name: "Allow" })),
			),
		);
		await waitFor(() =>
			expect(view.getByText(/Not granted: no project shop/)).toBeTruthy(),
		);
		expect(view.getByRole("button", { name: "Allow" })).toBeTruthy();
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([]);
	});

	it("folds to a line once the person has granted it", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Cart",
				messages: [ask, message("user", "[SPLATES GRANTED]")],
			}),
		]);
		await waitFor(() =>
			expect(view.getByText("Granted splates tasks in shop")).toBeTruthy(),
		);
		expect(view.queryByRole("button", { name: "Allow" })).toBeNull();
		expect(view.queryByText("Reach granted")).toBeNull();
	});
});
