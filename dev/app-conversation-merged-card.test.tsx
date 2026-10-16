import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Outcome } from "../outcomes";
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

	it("asks the agent to investigate every finding, and says so in place", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [message("agent", "## ✅ Merged header onto main\n\nDone.")],
			}),
		]);
		const went = await waitFor(() =>
			view.getByRole("region", { name: "how it went" }),
		);

		await act(async () =>
			fireEvent.click(
				within(went).getByRole("button", { name: "Investigate" }),
			),
		);

		const [sent] = testing.posted("/api/conversations/c1/prompt");
		expect(sent?.body.text).toStartWith(
			"[ARBOR INVESTIGATE header]\n\n- You stopped a turn\n",
		);
		expect(within(went).getByText("Investigating")).not.toBeNull();
	});

	it("shows the systems the task touched as chips", async () => {
		testing.landed.header = {
			outcome: { ...header(), systems: ["arbor-dev", "skill"] },
			baseline: null,
		};
		const view = await testing.openConversations([
			conversation({
				messages: [message("agent", "## ✅ Merged header onto main\n\nDone.")],
			}),
		]);
		const systems = await waitFor(() =>
			view.getByRole("list", { name: "systems" }),
		);

		expect(
			within(systems)
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(["arbor-dev", "skill"]);
	});

	it("defers one finding as an untriaged todo, then says Deferred on its line", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [message("agent", "## ✅ Merged header onto main\n\nDone.")],
			}),
		]);
		const findings = await waitFor(() =>
			view.getByRole("list", { name: "findings" }),
		);

		await act(async () =>
			fireEvent.click(within(findings).getByRole("button", { name: "Defer" })),
		);

		expect(testing.posted("/api/todos")).toMatchObject([
			{ method: "POST", body: { subject: "You stopped a turn" } },
		]);
		expect(within(findings).getByText("Deferred")).not.toBeNull();
	});

	it("offers Defer on each finding an Investigated report left, under what it fixed", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [
					message(
						"agent",
						[
							"## 🔎 Investigated header",
							"",
							"The header test no longer waits on a font.",
							"",
							"- The gate keeps failing on `wraps at 390px`: it needs a browser.",
						].join("\n"),
					),
				],
			}),
		]);
		const card = await waitFor(() =>
			view.getByRole("region", { name: "investigated header" }),
		);
		expect(card.textContent).toContain("no longer waits on a font");
		const left = within(card).getByRole("list", { name: "left unfixed" });

		await act(async () =>
			fireEvent.click(within(left).getByRole("button", { name: "Defer" })),
		);

		expect(testing.posted("/api/todos")).toMatchObject([
			{
				method: "POST",
				body: { subject: "The gate keeps failing on wraps at 390px" },
			},
		]);
	});
});
