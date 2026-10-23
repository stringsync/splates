import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Outcome } from "@stringsync/splates-server/stats/browser";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	waitFor,
	within,
} from "./testing";

function header(): Outcome {
	return {
		project: "/repo",
		task: "header",
		base: "main",
		ended: "merged",
		startedAt: "2026-10-14T09:20:00.000Z",
		endedAt: "2026-10-14T10:00:00.000Z",
		questionRounds: 0,
		reviewRounds: 0,
		failedMerges: 0,
		findings: [{ kind: "stopped", at: "2026-10-14T09:30:00.000Z" }],
		conversation: "c1",
		agent: null,
		model: null,
	};
}

describe("App's merged card actions", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		testing.landed.header = { outcome: header(), baseline: null };
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("names the companions of a shared landing gate", async () => {
		testing.landed.header = {
			outcome: { ...header(), batch: ["sidebar", "header", "footer"] },
			baseline: null,
		};
		const view = await testing.openConversations([
			conversation({
				messages: [message("agent", "## ✅ Merged header onto main\n\nDone.")],
			}),
		]);
		const card = view.getByRole("region", { name: "merged header" });
		await waitFor(() =>
			expect(
				within(card).getByText("Gated with sidebar, footer"),
			).not.toBeNull(),
		);
	});

	it("says how many calls the person made", async () => {
		testing.landed.header = {
			outcome: {
				...header(),
				decisions: [
					{
						number: "1",
						text: "Keep the old endpoint?",
						size: "large",
						ended: "kept",
					},
					{
						number: "2",
						text: "Retry limit",
						size: "small",
						ended: "overturned",
					},
				],
			},
			baseline: null,
		};
		const view = await testing.openConversations([
			conversation({
				messages: [message("agent", "## ✅ Merged header onto main\n\nDone.")],
			}),
		]);
		const went = await waitFor(() =>
			view.getByRole("region", { name: "how it went" }),
		);

		expect(within(went).getByText("2 by you")).not.toBeNull();
		expect(within(went).queryByText(/by agent/)).toBeNull();
	});

	it("shows the outcome the plan ended on, and asks the conversation's own agent to demo it from the card's foot", async () => {
		testing.landed.header = {
			outcome: {
				...header(),
				outcome: "Moved the header.\n\n### Demo\n\nOpen the page.",
			},
			baseline: null,
		};
		const view = await testing.openConversations([
			conversation({
				messages: [message("agent", "## ✅ Merged header onto main\n\nDone.")],
			}),
		]);
		const card = view.getByRole("region", { name: "merged header" });
		expect(within(card).getByText("Done.")).not.toBeNull();
		expect(within(card).queryByText("Moved the header.")).toBeNull();
		await act(async () =>
			fireEvent.click(
				await waitFor(() => within(card).getByRole("button", { name: "More" })),
			),
		);
		const outcome = view.getByRole("region", { name: "outcome" });
		expect(within(outcome).getByText("Moved the header.")).not.toBeNull();
		expect(within(outcome).queryByRole("button")).toBeNull();
		expect(within(card).queryByRole("button", { name: "More" })).toBeNull();

		// The bar above the composer offers it too while the card's foot is
		// out of sight.
		await waitFor(() =>
			within(view.getByRole("region", { name: "archive" })).getByRole(
				"button",
				{ name: "Demo it" },
			),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					within(card).getByRole("button", { name: "Demo it" }),
				),
			),
		);

		await waitFor(() =>
			expect(
				testing
					.posted("/api/conversations/c1/prompt")
					.map((post) => JSON.stringify(post)),
			).toEqual([expect.stringContaining("[SPLATES DEMO header after]")]),
		);
	});

	it("leads with the outcome's first paragraph when the report says nothing, and offers no More when there is no more", async () => {
		testing.landed.header = {
			outcome: { ...header(), outcome: "Moved the header." },
			baseline: null,
		};
		const view = await testing.openConversations([
			conversation({
				messages: [message("agent", "## ✅ Merged header onto main")],
			}),
		]);
		const card = view.getByRole("region", { name: "merged header" });

		await waitFor(() => within(card).getByText("Moved the header."));
		expect(within(card).queryByRole("button", { name: "More" })).toBeNull();
	});

	it("offers no demo for an outcome that says none, nor on a merge the conversation carried on past", async () => {
		testing.landed.header = {
			outcome: { ...header(), outcome: "Moved the header." },
			baseline: null,
		};
		testing.landed.footer = {
			outcome: {
				...header(),
				task: "footer",
				outcome: "Moved the footer.\n\n### Demo\n\nOpen the page.",
			},
			baseline: null,
		};
		const view = await testing.openConversations([
			conversation({
				messages: [
					message("agent", "## ✅ Merged footer onto main\n\nDone."),
					message("user", "now the header"),
					message("agent", "## ✅ Merged header onto main\n\nDone."),
				],
			}),
		]);
		await waitFor(() =>
			expect(
				view
					.getAllByRole("region", { name: /^merged / })
					.map(
						(card) =>
							within(card).queryByRole("button", { name: "More" }) !== null,
					),
			).toEqual([true, true]),
		);
		await waitFor(() =>
			within(view.getByRole("region", { name: "merged header" })).getByRole(
				"button",
				{ name: "Archive" },
			),
		);

		expect(view.queryByRole("button", { name: "Demo it" })).toBeNull();
	});
});
