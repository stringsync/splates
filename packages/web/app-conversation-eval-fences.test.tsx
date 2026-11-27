import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup, conversation, message, Testing, waitFor } from "./testing";

const REPORT = {
	eval: "times out cleanly",
	agent: "claude:haiku",
	status: "error",
	error: "agent timed out after 60s",
	transcript: [],
	checks: [],
	judge: null,
	usage: { usd: null, turns: null, seconds: 60 },
	fault: "harness",
};

const PROPOSAL = [
	"```eval",
	"id: splates/add-before-investigating",
	"title: starts a task with splates add before investigating a code change",
	"you: Fix the off-by-one bug in `paginate.ts`.",
	"agent: Investigates inside the new worktree.",
	"check: a task exists before the first read of `paginate.ts`",
	"```",
].join("\n");

describe("App's eval fences in an agent's reply", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	async function open(text: string) {
		return testing.openConversations([
			conversation({
				messages: [message("user", "run the eval"), message("agent", text)],
			}),
		]);
	}

	it("draws an eval-report fence as the run report card", async () => {
		const view = await open(
			`The run errored.\n\n\`\`\`eval-report\n${JSON.stringify(REPORT, null, 2)}\n\`\`\``,
		);

		const card = await waitFor(() => {
			const found = view.container.querySelector('[data-slot="eval-report"]');
			expect(found).not.toBeNull();
			return found as Element;
		});
		expect(card.textContent).toContain("agent timed out after 60s");
		expect(view.queryByText("eval-report")).toBeNull();
	});

	it("draws a bare eval fence as the eval card", async () => {
		const view = await open(`Here is one.\n\n${PROPOSAL}`);

		await waitFor(() =>
			expect(
				view.container.querySelector('[data-slot="eval-proposal"]'),
			).not.toBeNull(),
		);
	});

	it("keeps a fence that does not parse as code under its header", async () => {
		const view = await open("Broken.\n\n```eval-report\nnot json\n```");

		await waitFor(() => expect(view.getByText("not json")).toBeTruthy());
		expect(view.getByText("eval-report")).toBeTruthy();
		expect(
			view.container.querySelector('[data-slot="eval-report"]'),
		).toBeNull();
	});
});
