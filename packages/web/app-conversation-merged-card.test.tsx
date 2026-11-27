import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Outcome } from "@splates/server/stats/browser";
import {
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

	it("leads with the record's Before and After open, the agent's words above the card", async () => {
		testing.landed.header = {
			outcome: {
				...header(),
				outcome:
					"## Before\n\nThe header wraps.\n\n## After\n\nThe header stays on one line.\n\nChecked at 390px.",
			},
			baseline: null,
		};
		const view = await testing.openConversations([
			conversation({
				messages: [
					message(
						"agent",
						"## ✅ Merged header onto main\n\nThe report's words.",
					),
				],
			}),
		]);
		const card = await waitFor(() =>
			view.getByRole("region", { name: "merged header" }),
		);
		const before = within(card).getByRole("region", { name: "before" });
		expect(within(before).getByText("The header wraps.")).not.toBeNull();
		const after = within(card).getByRole("region", { name: "after" });
		expect(within(after).getByText("Checked at 390px.")).not.toBeNull();
		expect(
			within(card).getByText("The header stays on one line."),
		).not.toBeNull();
		expect(within(card).queryByText("The report's words.")).toBeNull();
		expect(view.getByText("The report's words.")).not.toBeNull();
		expect(within(card).queryByRole("region", { name: "checks" })).toBeNull();
	});

	it("opens the record's Checks to each with its note, folding to their counts", async () => {
		testing.landed.header = {
			outcome: {
				...header(),
				outcome: [
					"## Before\n\nThe header wraps.",
					"## After\n\nThe header stays on one line.",
					"## Checks\n\n- [x] Checked at 390px\n- [ ] Not tried in Safari\n  No Mac to hand.",
				].join("\n\n"),
			},
			baseline: null,
		};
		const view = await testing.openConversations([
			conversation({
				messages: [message("agent", "## ✅ Merged header onto main\n\nDone.")],
			}),
		]);
		const checks = await waitFor(() =>
			view.getByRole("region", { name: "checks" }),
		);
		expect(within(checks).getByText("No Mac to hand.")).not.toBeNull();

		fireEvent.click(within(checks).getByRole("button", { name: "Checks" }));
		expect(checks.textContent).toContain("✓ 1 passed");
		expect(checks.textContent).toContain("! 1 not checked");
		expect(within(checks).queryByText("No Mac to hand.")).toBeNull();

		fireEvent.click(within(checks).getByRole("button", { name: "Checks" }));
		expect(
			within(checks).getByRole("listitem", {
				name: "passed: Checked at 390px",
			}),
		).not.toBeNull();
		expect(
			within(checks).getByRole("listitem", {
				name: "not checked: Not tried in Safari",
			}),
		).not.toBeNull();
		expect(within(checks).getByText("No Mac to hand.")).not.toBeNull();
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
		const stats = await waitFor(() =>
			within(card).getByRole("button", { name: "Stats" }),
		);
		fireEvent.click(stats);
		expect(within(card).getByText("Gated with sidebar, footer")).not.toBeNull();
	});

	it("gives a removed card its time and size, without the gate", async () => {
		testing.landed.header = {
			outcome: {
				...header(),
				ended: "removed",
				size: { files: 2, added: 10, removed: 3 },
			},
			baseline: null,
		};
		const view = await testing.openConversations([
			conversation({
				messages: [
					message(
						"agent",
						"## 🧹 Removed header: superseded by a fix on main\n\nThe task set out to move the header.",
					),
				],
			}),
		]);
		const went = await waitFor(() =>
			view.getByRole("region", { name: "stats" }),
		);
		fireEvent.click(within(went).getByRole("button", { name: "Stats" }));

		expect(within(went).getByText("Time")).not.toBeNull();
		expect(within(went).getByText("2 files")).not.toBeNull();
		expect(within(went).queryByText("Gate passed first try")).toBeNull();
		expect(within(went).queryByText("Decisions")).toBeNull();
	});

	it("shows an older outcome in full under its own Summary, the agent's words above the card", async () => {
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
		expect(
			within(card).getByRole("heading", { name: "Summary" }),
		).not.toBeNull();
		expect(within(card).queryByText("Done.")).toBeNull();
		expect(view.getByText("Done.")).not.toBeNull();
		expect(within(card).getByText("Moved the header.")).not.toBeNull();
		const outcome = await waitFor(() =>
			view.getByRole("region", { name: "outcome" }),
		);
		expect(within(outcome).getByText("Open the page.")).not.toBeNull();
		expect(within(card).queryByRole("button", { name: "More" })).toBeNull();
	});

	it("leads with the outcome's first paragraph when the report says nothing, with nothing under it when there is no more", async () => {
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
		expect(within(card).queryByRole("region", { name: "outcome" })).toBeNull();
	});
});
