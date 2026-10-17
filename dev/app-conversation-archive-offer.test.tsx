import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Event } from "../events";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	second,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's offer to archive a conversation whose task is over", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("offers to archive the conversation above the composer while its last word reports a task that is over, then goes on to a new one with none waiting", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [
					message(
						"agent",
						"## ✅ Merged header onto main\n\nThe header wraps now.",
					),
					message("user", "now the footer"),
					message(
						"agent",
						[
							"## ⚠️ Escalated footer: needs a call on the color",
							"",
							"The footer is gray.",
							"",
							"## 🛑 Removed sidebar: superseded by a fix on main",
							"",
							"It set out to fold the sidebar.",
						].join("\n"),
					),
				],
			}),
		]);

		const bar = await waitFor(() =>
			view.getByRole("region", { name: "archive" }),
		);
		// The last report names the task, and only its card offers it too.
		expect(bar.textContent).toContain("Removed");
		expect(bar.textContent).toContain("sidebar");
		const archiveIn = (name: string) =>
			within(view.getByRole("region", { name })).queryByRole("button", {
				name: "Archive",
			});
		expect(archiveIn("merged header")).toBeNull();
		expect(archiveIn("removed sidebar")).toBeTruthy();

		await act(async () =>
			fireEvent.click(within(bar).getByRole("button", { name: "Archive" })),
		);

		expect(testing.posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
		await waitFor(() => expect(location.hash).toBe("#conversations/new"));
		expect(view.getByText("Start a conversation with")).toBeTruthy();
	});

	it("offers no archiving once the conversation carries on past a report, or when the task escalated", async () => {
		const view = await testing.openConversations([
			conversation({
				id: "c1",
				title: "Carried on",
				messages: [
					message("agent", "## ✅ Merged header onto main\n\nIt wraps."),
					message("user", "how far does it wrap?"),
					message("agent", "To two lines."),
				],
			}),
			conversation({
				id: "c2",
				title: "Escalated",
				messages: [
					message(
						"agent",
						"## ⚠️ Escalated footer: needs a call on the color\n\nIt is gray.",
					),
				],
			}),
		]);

		await waitFor(() => view.getByText("To two lines."));
		expect(view.queryByRole("region", { name: "archive" })).toBeNull();
		await act(async () => {
			location.hash = "#conversations/c2";
		});
		await waitFor(() => view.getByRole("region", { name: "escalated footer" }));
		expect(view.queryByRole("region", { name: "archive" })).toBeNull();
	});

	// scry-ignore simple-test-setup: its IntersectionObserver stub is its own, which no other test shares
	it("leaves the bar out while the report card's own Archive is in sight, which archives too", async () => {
		const real = globalThis.IntersectionObserver;
		// The card's Archive, as the observer last watched it.
		let watched: ((ratio: number) => void) | null = null;
		globalThis.IntersectionObserver = class {
			constructor(private readonly callback: IntersectionObserverCallback) {}
			observe(target: Element) {
				watched = (ratio) =>
					this.callback(
						[{ target, intersectionRatio: ratio } as IntersectionObserverEntry],
						{} as IntersectionObserver,
					);
			}
			disconnect() {}
		} as unknown as typeof IntersectionObserver;
		const scroll = (ratio: number) => act(async () => watched?.(ratio));
		try {
			const view = await testing.openConversations([
				conversation({
					messages: [
						message("user", "fix the header"),
						message("agent", "## ✅ Merged header onto main\n\nIt wraps."),
					],
				}),
			]);
			const bar = () => view.queryByRole("region", { name: "archive" });
			await waitFor(() => expect(bar()).toBeTruthy());

			await scroll(1);
			expect(bar()).toBeNull();

			await scroll(0.2);
			expect(bar()).toBeTruthy();

			await scroll(1);
			await act(async () =>
				fireEvent.click(
					within(view.getByRole("region", { name: "merged header" })).getByRole(
						"button",
						{ name: "Archive" },
					),
				),
			);
			expect(testing.posted("/api/conversations/c1/archived")).toEqual([
				{ method: "PUT", body: { archived: true } },
			]);
		} finally {
			globalThis.IntersectionObserver = real;
		}
	});

	it("offers no archiving once arbor shows something after the report, such as a task added", async () => {
		const added: Event = {
			id: "a1",
			at: second(30),
			action: "add",
			task: "footer",
			reason: null,
			conversation: "c1",
			base: "main",
			todos: [],
			goal: "Fix the footer",
			subjects: [],
			agent: null,
			model: null,
		};
		const view = await testing.openConversations([
			conversation({
				messages: [
					{ ...message("user", "fix the header"), at: second(0) },
					{
						...message("agent", {
							type: "text",
							text: "## ✅ Merged header onto main\n\nIt wraps.",
							at: second(20),
						}),
						at: second(1),
					},
				],
				events: [added],
			}),
		]);

		const card = await waitFor(() =>
			view.getByRole("region", { name: "merged header" }),
		);
		expect(within(card).queryByRole("button", { name: "Archive" })).toBeNull();
		expect(view.queryByRole("region", { name: "archive" })).toBeNull();
	});
});
