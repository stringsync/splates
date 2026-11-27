import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	type ConversationsView,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's question cards one question at a time on a desktop", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const asked = (text: string) =>
		conversation({
			title: "Header",
			messages: [message("user", "fix the header"), message("agent", text)],
		});

	const plan = [
		"## 📝 Plan: wrap the header",
		"",
		"**Goal:** The header overflows on a phone.",
		"",
		"1. Which pages need it?",
		"   - (a) Todos (chosen)",
		"   - (b) Tasks",
		"2. How should a stale todo be shown?",
		"   - (a) A muted card (chosen)",
		"   - (b) A badge",
		"3. Should tablets wrap it too?",
		"   - (a) Wrap it too",
		"   - (b) Leave tablets",
		"4. Do you approve wrapping the header?",
		"   - (a) Yes, approve it",
		"   - (b) No",
	].join("\n");

	const steps = (view: ConversationsView) =>
		within(view.getByRole("navigation", { name: "question steps" }))
			.getAllByRole("button", { name: /^question/ })
			.map((step) => step.getAttribute("aria-label"));

	const shown = (view: ConversationsView) =>
		within(view.getByRole("list", { name: "questions" }))
			.getAllByRole("listitem")
			.map((each) => each.getAttribute("aria-label"));

	const click = async (view: ConversationsView, name: string | RegExp) =>
		act(async () => fireEvent.click(view.getByRole("button", { name })));

	it("shows the first question under the plan, with a step for each marked as it stands", async () => {
		const view = await testing.openConversations([asked(plan)]);
		await waitFor(() =>
			view.getByRole("navigation", { name: "question steps" }),
		);

		expect(shown(view)).toEqual(["question 1"]);
		expect(view.getByText(/The header overflows on a phone/)).toBeTruthy();
		expect(steps(view)).toEqual([
			"question 1, answered and seen",
			"question 2, picked, not yet seen",
			"question 3, unanswered",
			"question 4, unanswered",
		]);
		expect(view.getByText("Question 1 of 4")).toBeTruthy();
	});

	it("turns with Next and Back, marking a question seen once turned to, and leaves the plan on the first", async () => {
		const view = await testing.openConversations([asked(plan)]);
		await waitFor(() => view.getByRole("button", { name: /^Next$/ }));

		await click(view, /^Next$/);
		expect(shown(view)).toEqual(["question 2"]);
		expect(view.queryByText(/The header overflows on a phone/)).toBeNull();
		expect(steps(view)[1]).toBe("question 2, answered and seen");

		await click(view, /Back/);
		expect(shown(view)).toEqual(["question 1"]);
	});

	it("goes to the first question with no answer, and sends from the last, with anything else under it", async () => {
		const view = await testing.openConversations([asked(plan)]);
		await waitFor(() => view.getByRole("button", { name: /Next unanswered/ }));

		await click(view, /Next unanswered/);
		expect(shown(view)).toEqual(["question 3"]);
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("listitem", { name: "question 3" })).getByRole(
					"button",
					{ name: /Wrap it too/ },
				),
			),
		);
		await click(view, /Next unanswered/);
		expect(shown(view)).toEqual(["question 4"]);
		expect(view.getByRole("textbox", { name: "Anything else" })).toBeTruthy();
		expect(view.queryByRole("button", { name: /^Next$/ })).toBeNull();
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("listitem", { name: "question 4" })).getByRole(
					"button",
					{ name: /Yes, approve it/ },
				),
			),
		);
		expect(view.queryByRole("button", { name: /Next unanswered/ })).toBeNull();

		await click(view, "Send");

		expect(testing.posted("/api/conversations/c1/prompt")).toHaveLength(1);
	});

	it("jumps to a question from its step", async () => {
		const view = await testing.openConversations([asked(plan)]);
		await waitFor(() => view.getByRole("button", { name: /^question 3,/ }));

		await click(view, /^question 3,/);

		expect(shown(view)).toEqual(["question 3"]);
		expect(
			view
				.getByRole("button", { name: /^question 3,/ })
				.getAttribute("aria-current"),
		).toBe("step");
	});

	it("shows every question on Show all, and one at a time again from the footer", async () => {
		const view = await testing.openConversations([asked(plan)]);
		await waitFor(() => view.getByRole("button", { name: "Show all" }));

		await click(view, "Show all");
		expect(shown(view)).toEqual([
			"question 1",
			"question 2",
			"question 3",
			"question 4",
		]);
		expect(
			view.queryByRole("navigation", { name: "question steps" }),
		).toBeNull();

		await click(view, "One at a time");
		expect(shown(view)).toEqual(["question 1"]);
	});

	it("asks the plan's approval as an ordinary question, with no Approved checkbox", async () => {
		const view = await testing.openConversations([asked(plan)]);
		await waitFor(() => view.getByRole("button", { name: /^question 4,/ }));

		expect(steps(view)).toHaveLength(4);
		expect(view.queryByRole("checkbox", { name: "Approved" })).toBeNull();
		await click(view, /^question 4,/);
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("listitem", { name: "question 4" })).getByRole(
					"button",
					{ name: /Yes, approve it/ },
				),
			),
		);
		expect(view.queryByRole("button", { name: "Approve" })).toBeNull();
		await click(view, "Send");

		const [sent] = testing.posted("/api/conversations/c1/prompt") as {
			body: { text: string };
		}[];
		expect(sent?.body.text).toContain(
			"> **Do you approve wrapping the header?**\n\n- (a) Yes, approve it",
		);
	});

	it("sends the other answers without approving while the approval question is unanswered", async () => {
		const view = await testing.openConversations([asked(plan)]);
		await waitFor(() => view.getByRole("button", { name: "Show all" }));

		await click(view, "Show all");
		await click(view, "Send");

		const [sent] = testing.posted("/api/conversations/c1/prompt") as {
			body: { text: string };
		}[];
		expect(sent?.body.text).toContain("Which pages need it?");
		expect(sent?.body.text).not.toContain("Do you approve");
	});

	it("gives a plan's decision a step of its own after its questions, with anything else under it", async () => {
		const view = await testing.openConversations([
			asked(
				"## 📝 Plan: wrap the header\n\n**Goal:** The header overflows.\n\n1. Which pages need it?\n   - (a) Todos (chosen)\n   - (b) Tasks",
			),
		]);
		await waitFor(() => view.getByRole("button", { name: "plan decision" }));

		expect(shown(view)).toEqual(["question 1"]);
		expect(view.queryByRole("button", { name: "Approve" })).toBeNull();
		expect(view.queryByRole("textbox", { name: "Anything else" })).toBeNull();
		expect(view.queryByRole("button", { name: "Send" })).toBeNull();

		await click(view, /^Next$/);
		expect(view.queryByRole("list", { name: "questions" })).toBeNull();
		expect(view.getByText("Approve this plan?")).toBeTruthy();
		expect(view.getByRole("textbox", { name: "Anything else" })).toBeTruthy();
		expect(
			view
				.getByRole("button", { name: "plan decision" })
				.getAttribute("aria-current"),
		).toBe("step");

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Approve" })),
		);
		await click(view, "Send");
		const [sent] = testing.posted("/api/conversations/c1/prompt") as {
			body: { text: string };
		}[];
		expect(sent?.body.text).toStartWith("Approve: wrap the header");
	});

	it("shows a lone question as it is, with no steps", async () => {
		const view = await testing.openConversations([
			asked("1. Which pages need it?\n   - (a) Todos\n   - (b) Tasks"),
		]);
		await waitFor(() => view.getByRole("list", { name: "questions" }));

		expect(
			view.queryByRole("navigation", { name: "question steps" }),
		).toBeNull();
		expect(view.queryByRole("button", { name: "Show all" })).toBeNull();
	});
});
