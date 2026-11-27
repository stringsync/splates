import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Stuck } from "@splates/server/server";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	project,
	resize,
	Testing,
	waitFor,
} from "./testing";

const STUCK: Stuck = {
	upstream: "origin/main",
	local: "f55fe61fe31d74b4653011d6ba56e0ea11a9bb16",
	newest: "05a8961839ff4872f59f27e61a64e14e3878a74c",
	commits: 25,
	root: "/Users/jared/Projects/mono",
	dirty: 18,
};

describe("App's stuck checkout indicator", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		resize(1024, 768);
	});

	it("shows an amber Stuck button in the Update slot and sends an investigation to an agent", async () => {
		testing.reply = conversation({ id: "c-stuck", status: "running" });
		const view = await testing.openConversations([], null, {
			root: STUCK.root,
			stuck: STUCK,
		});

		const trigger = await waitFor(() =>
			view.getByRole("button", { name: "Update stuck" }),
		);
		expect(trigger.textContent).toBe("Stuck");

		await act(async () => fireEvent.click(trigger));
		await waitFor(() => view.getByText("Server checkout is behind"));
		expect(document.body.textContent).toContain("25 server commits");
		expect(document.body.textContent).toContain("origin/main");
		expect(document.body.textContent).toContain("f55fe61f");
		expect(document.body.textContent).toContain(
			"18 uncommitted changes in ~/Projects/mono",
		);

		const sendButton = view.getByRole("button", { name: "Send to agent" });
		await act(async () => fireEvent.click(sendButton));

		await waitFor(() => {
			expect(
				testing.posts.some(
					(each) =>
						each.path === "/api/conversations/c-stuck/prompt" &&
						each.method === "POST",
				),
			).toBe(true);
		});
		const startPost = testing.posts.find(
			(each) =>
				each.path === "/api/conversations/auto" ||
				each.path === "/api/conversations",
		);
		expect(startPost).toBeDefined();
		const promptPost = testing.posts.find(
			(each) => each.path === "/api/conversations/c-stuck/prompt",
		);
		const promptText =
			promptPost?.body instanceof FormData
				? String(promptPost.body.get("text") ?? "")
				: "";
		expect(promptText).toContain("25 server commits behind origin/main");
		expect(promptText).toContain("18 uncommitted changes");
		expect(location.hash).toBe("#conversations/c-stuck");
	});

	it("shows Stuck on phones in the top bar too", async () => {
		resize(390, 844);
		const view = await testing.openConversations([], null, {
			root: STUCK.root,
			stuck: STUCK,
		});
		const trigger = await waitFor(() =>
			view.getByRole("button", { name: "Update stuck" }),
		);
		expect(trigger.textContent).toBe("Stuck");
	});

	it("prioritizes Update when a local restart update is also ready", async () => {
		const view = await testing.open({
			behind: { running: STUCK.local, newest: STUCK.newest },
			stuck: STUCK,
		});
		await waitFor(() => view.getByRole("button", { name: "Update" }));
		expect(view.queryByRole("button", { name: "Update stuck" })).toBeNull();
	});

	it("starts the investigation in the server checkout's project when viewing another project", async () => {
		testing.projects = [
			project("other", [], true),
			{ ...project("mono", [], false), root: STUCK.root },
		];
		testing.reply = conversation({ id: "c-mono", status: "running" });
		const view = await testing.openConversations([], null, {
			root: "/Users/jared/Projects/other",
			stuck: STUCK,
		});

		const trigger = await waitFor(() =>
			view.getByRole("button", { name: "Update stuck" }),
		);
		await act(async () => fireEvent.click(trigger));
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Send to agent" })),
		);

		await waitFor(() => {
			expect(
				testing.posts.some(
					(each) =>
						each.path === "/api/conversations/auto?project=mono" &&
						each.method === "POST",
				),
			).toBe(true);
		});
		expect(
			testing.posts.some(
				(each) =>
					each.path === "/api/conversations/c-mono/prompt?project=mono" &&
					each.method === "POST",
			),
		).toBe(true);
		expect(location.search).toBe("?project=mono");
		expect(location.hash).toBe("#conversations/c-mono");
	});
});
