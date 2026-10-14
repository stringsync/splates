import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "../conversations";
import {
	act,
	type ConversationsView,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	textIn,
	waitFor,
	within,
} from "./testing";

describe("App's question cards", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const report = [
		"## ⚠️ Escalated header: waiting on two calls",
		"",
		"The header wraps now.",
		"",
		"1. Which pages need it?",
		"   - [a] Todos",
		"   - [b] Tasks",
		"2. How should a stale todo be shown?",
		"   - (a) A muted card",
		"   - (b) A badge",
		"3. Ready to merge?",
	].join("\n");

	const asking = (status: ConversationState["status"] = "idle") =>
		conversation({
			title: "Header",
			status,
			messages: [message("user", "fix the header"), message("agent", report)],
		});

	const box = (view: ConversationsView) =>
		view.getByRole("textbox", {
			name: "Message input",
		});

	const card = (view: ConversationsView, question: string) =>
		view.getByRole("listitem", { name: `question ${question}` });

	it("shows each question as a card, the text around them as written", async () => {
		const view = await testing.openConversations([asking()]);

		const cards = await waitFor(() =>
			view.getByRole("list", { name: "questions" }),
		);
		expect(
			within(cards)
				.getAllByRole("listitem")
				.map((card) => card.getAttribute("aria-label")),
		).toEqual(["question 1", "question 2", "question 3"]);
		expect(view.getByText("The header wraps now.")).toBeTruthy();
		expect(view.queryByText("- (a) A muted card")).toBeNull();
	});

	it("asks an escalation's questions in its card, headed as the escalation", async () => {
		const view = await testing.openConversations([asking()]);

		const escalated = await waitFor(() =>
			view.getByRole("region", { name: "escalated header" }),
		);
		expect(escalated.textContent).toContain("Escalated");
		expect(escalated.textContent).toContain("waiting on two calls");
		expect(escalated.textContent).toContain("The header wraps now.");
		expect(
			within(escalated).getByRole("list", { name: "questions" }),
		).toBeTruthy();
		expect(view.getAllByRole("region", { name: /escalated/ })).toHaveLength(1);
		expect(
			view.queryByRole("region", { name: "questions for you" }),
		).toBeNull();
	});

	it("asks questions outside an escalation in a card of their own", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [
					message("user", "fix the header"),
					message(
						"agent",
						"Working on it.\n\n1. Which pages need it?\n2. Should it wrap?",
					),
				],
			}),
		]);

		const asked = await waitFor(() =>
			view.getByRole("region", { name: "questions for you" }),
		);
		expect(within(asked).getByRole("list", { name: "questions" })).toBeTruthy();
		expect(view.queryByRole("region", { name: /escalated/ })).toBeNull();
	});

	it("renders markdown in a question's subject and choices", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Header",
				messages: [
					message("user", "fix the header"),
					message(
						"agent",
						[
							"1. Should `Header` wrap?",
							"   - (a) **Always**",
							"   - (b) Only below `md`",
						].join("\n"),
					),
				],
			}),
		]);

		const asked = await waitFor(() => card(view, "1"));
		expect(
			[...asked.querySelectorAll("code")].map((code) => code.textContent),
		).toEqual(["Header", "md"]);
		expect(asked.querySelector("strong")?.textContent).toBe("Always");
		expect(asked.textContent).not.toContain("`");
	});

	it("shows a screenshot indented under a choice with that choice", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Actions",
				messages: [
					message("user", "restyle the actions"),
					message(
						"agent",
						[
							"1. Which style should the actions take?",
							"   - (a) A rail",
							"     ![rail](/abs/rail.png)",
							"   - (b) A panel",
							"     ![panel](/abs/panel.png)",
						].join("\n"),
					),
				],
			}),
		]);

		const asked = await waitFor(() => card(view, "1"));
		const frame = (name: string) =>
			within(asked).getByRole("button", { name: new RegExp(name) })
				.parentElement as HTMLElement;
		// Under the choice, as its alt text where the file will not load.
		expect(frame("A rail").lastElementChild?.textContent).toContain("rail");
		expect(frame("A panel").lastElementChild?.textContent).toContain("panel");
		// The screenshots are no choices of their own.
		expect(
			within(asked)
				.getAllByRole("button", { pressed: false })
				.map((each) => each.textContent),
		).toEqual(["aA rail", "bA panel"]);
	});

	it("keeps the answers in the card, never the composer, and sends them from it with anything else", async () => {
		const QUOTED = [
			"Also the footer.",
			"",
			"> **Which pages need it?**",
			"",
			"- (a) Todos",
			"- (b) Tasks",
			"",
			"> **How should a stale todo be shown?**",
			"",
			"- (a) A muted card",
			"",
			"only on phones",
		].join("\n");
		const view = await testing.openConversations([asking()]);
		await waitFor(() => card(view, "2"));
		const choice = async (question: string, name: string) =>
			act(async () =>
				fireEvent.click(
					within(card(view, question)).getByRole("button", {
						name: new RegExp(name),
					}),
				),
			);
		const send = view.getByRole("button", {
			name: "Send",
		}) as HTMLButtonElement;
		expect(send.disabled).toBe(true);

		await choice("2", "A badge");
		await choice("1", "Tasks");
		await choice("1", "Todos");
		await choice("2", "A muted card");
		expect(
			within(card(view, "2"))
				.getByRole("button", { name: /A muted card/ })
				.getAttribute("aria-pressed"),
		).toBe("true");
		// Answered, it keeps its number.
		expect(card(view, "2").textContent).toStartWith("2 answered");
		const note = (question: string) =>
			within(card(view, question)).getByRole("textbox") as HTMLTextAreaElement;
		await act(async () =>
			fireEvent.change(note("2"), { target: { value: "only on phones" } }),
		);
		await act(async () =>
			fireEvent.change(note("3"), {
				target: { value: "after a\nphone check" },
			}),
		);
		expect(note("2").value).toBe("only on phones");
		expect(view.getByText("3 of 3 answered")).toBeTruthy();
		await act(async () =>
			fireEvent.change(note("3"), { target: { value: "" } }),
		);
		expect(view.getByText("2 of 3 answered")).toBeTruthy();
		await act(async () =>
			fireEvent.change(view.getByRole("textbox", { name: "Anything else" }), {
				target: { value: "Also the footer." },
			}),
		);
		expect(textIn(box(view))).toBe("");
		expect(
			localStorage.getItem("arbor.draft.c1:questions:1:Which pages need it?"),
		).toBe(QUOTED);
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([]);

		await act(async () => fireEvent.click(send));

		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{
				method: "POST",
				body: { text: QUOTED },
			},
		]);
	});
});
