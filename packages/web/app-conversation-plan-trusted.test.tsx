import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	cleanup,
	conversation,
	fireEvent,
	message,
	resize,
	Testing,
	tool,
} from "./testing";

const PLAN = "## 📝 Plan: Retry uploads\n\n**Goal:** Retry once.";
const TRUSTED = { band: "ask-and-go", score: 78 } as const;

describe("App's plan an agent went ahead on with trust", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	// Gone ahead: the agent works on after the plan, in the same turn.
	const went = message("agent", PLAN, tool(), "Building it now.");
	const posted = (agent = went, trusted = true) =>
		conversation({
			title: "Uploads",
			messages: [
				message("user", "retry uploads"),
				{ ...agent, ...(trusted ? { trusted: TRUSTED } : {}) },
			],
		});

	it("folds the plan into a green line saying trust approved it, not the person", async () => {
		const view = await testing.openConversations([posted()]);
		const line = await view.findByText(
			"Plan approved on trust, not by you · 78/100",
		);
		const shield = line.closest("p")?.querySelector(".lucide-shield-check");
		expect(shield?.getAttribute("class")).toContain("text-success");
		expect(view.queryByText("Awaiting approval")).toBeNull();
		expect(view.queryByText("Retry once.")).toBeNull();
	});

	it("opens the plan for changes from its line", async () => {
		const view = await testing.openConversations([posted()]);
		fireEvent.click(await view.findByRole("button", { name: "Show" }));
		expect(await view.findByText("Retry once.")).toBeTruthy();
		expect(view.getByRole("button", { name: "Hide" })).toBeTruthy();
	});

	it("leaves a plan the turn ended on waiting for the person", async () => {
		const view = await testing.openConversations([
			posted(message("agent", PLAN)),
		]);
		expect(await view.findByText("Retry once.")).toBeTruthy();
		expect(
			view.queryByText("Plan approved on trust, not by you · 78/100"),
		).toBeNull();
	});

	it("leaves a plan below ask-and-go as it was", async () => {
		const view = await testing.openConversations([posted(went, false)]);
		expect(await view.findByText("Retry once.")).toBeTruthy();
		expect(view.queryByText(/approved on trust/)).toBeNull();
	});

	it("stays a line in a phone's thread, waiting on nobody", async () => {
		resize(390, 844);
		try {
			const view = await testing.openConversations([posted()]);
			expect(
				await view.findByText("Plan approved on trust, not by you · 78/100"),
			).toBeTruthy();
			expect(
				view.queryByRole("complementary", { name: "Waiting on you" }),
			).toBeNull();
		} finally {
			resize(1024, 768);
		}
	});
});
