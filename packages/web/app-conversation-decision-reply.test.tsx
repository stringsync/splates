import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup, conversation, message, Testing } from "./testing";

const PLAN = "## 📝 Plan: Retry uploads\n\nRetry once.";

describe("App's plan decision replies", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const replied = (reply: string) =>
		conversation({
			title: "Uploads",
			messages: [message("agent", PLAN), message("user", reply)],
		});

	it("shows a bare approval only as the plan card's folded line", async () => {
		const view = await testing.openConversations([
			replied("Approve: Retry uploads\nPlan from 2026-11-26T12:00:00.000Z"),
		]);
		const line = await view.findByText("Plan approved");
		const mark = line.closest("p")?.querySelector(".lucide-check-check");
		expect(mark?.getAttribute("class")).toContain("text-success");
		expect(view.queryByText(/Plan from/)).toBeNull();
		expect(view.queryByText(/Approve: Retry uploads/)).toBeNull();
	});

	it("shows only the note a change request carries", async () => {
		const view = await testing.openConversations([
			replied(
				"Request changes: Retry uploads\nPlan from 2026-11-26T12:00:00.000Z\n\nRetry twice.",
			),
		]);
		await view.findByText("Retry twice.");
		const line = view.getByText("Changes requested").closest("p");
		const pencil = line?.querySelector(".lucide-pencil");
		expect(pencil).not.toBeNull();
		expect(pencil?.getAttribute("class")).not.toContain("text-");
		expect(view.queryByText(/Plan from/)).toBeNull();
		expect(view.queryByText(/Request changes: Retry uploads/)).toBeNull();
	});

	it("keeps a bare Approve typed by hand", async () => {
		const view = await testing.openConversations([replied("Approve")]);
		expect(await view.findByText("Approve")).toBeTruthy();
	});
});
