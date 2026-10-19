import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	tool,
	typeIn,
	within,
} from "./testing";

describe("App's asks", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("answers a permission with a digit: 1 denies, 2 allows once, 3 always", async () => {
		await testing.openConversations([
			conversation({
				status: "running",
				ask: {
					type: "permission",
					id: "t1",
					at: "2026-10-11T10:00:00.000Z",
					title: "rm -rf build",
					options: [
						{ id: "yes", name: "Allow", kind: "allow_once" },
						{ id: "no", name: "Reject", kind: "reject_once" },
					],
				},
			}),
		]);

		await act(async () => fireEvent.keyDown(document.body, { key: "1" }));

		expect(testing.posted("/api/conversations/c1/answer")).toEqual([
			{
				method: "POST",
				body: { ask: "t1", answer: { type: "permission", option: "no" } },
			},
		]);
	});

	it("sets the command a permission asks to run as code", async () => {
		const command = "git status && splates dev fix 2>&1 | tail -15";
		const view = await testing.openConversations([
			conversation({
				status: "running",
				messages: [
					message("agent", tool({ id: "t1", title: command, command })),
				],
				ask: {
					type: "permission",
					id: "t1",
					at: "2026-10-11T10:00:00.000Z",
					title: command,
					options: [{ id: "yes", name: "Allow", kind: "allow_once" }],
				},
			}),
		]);

		const card = view.getByRole("generic", { name: "permission" });
		expect(card.querySelector("code")?.textContent).toBe(command);
	});

	it("answers a question form in the questions card, its choice picked and its Other in words", async () => {
		const view = await testing.openConversations([
			conversation({
				status: "running",
				ask: {
					type: "question",
					id: "q1",
					at: "2026-10-11T10:00:00.000Z",
					message: "Uppercase the note?",
					fields: [
						{
							key: "question_0",
							title: "Uppercase",
							description: null,
							choices: [
								{ value: "yes", title: "Yes", description: null },
								{ value: "no", title: "No", description: null },
							],
						},
						{
							key: "question_0_custom",
							title: "Other",
							description: "Your own answer",
							choices: null,
						},
					],
				},
			}),
		]);
		const form = view.getByRole("form", { name: "question" });
		expect(form.textContent).toContain("Uppercase the note?");
		// "Other" is the words of the question it follows, not one of its own.
		const asked = within(form).getByRole("listitem", { name: "question 1" });
		expect(
			within(form).queryByRole("listitem", { name: "question 2" }),
		).toBeNull();

		await act(async () =>
			fireEvent.click(within(asked).getByRole("button", { name: /No/ })),
		);
		await typeIn(within(asked).getByRole("textbox"), "only the first line");
		expect(testing.posted("/api/conversations/c1/answer")).toEqual([]);
		await act(async () =>
			fireEvent.click(within(form).getByRole("button", { name: "Answer" })),
		);

		expect(testing.posted("/api/conversations/c1/answer")).toEqual([
			{
				method: "POST",
				body: {
					ask: "q1",
					answer: {
						type: "question",
						values: {
							question_0: "no",
							question_0_custom: "only the first line",
						},
					},
				},
			},
		]);
	});
});
