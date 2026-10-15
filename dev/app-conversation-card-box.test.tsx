import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FakeDictationLink, FakeMicrophone } from "webappwiz/dictate/testing";
import { Dictation } from "./dictation";
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

describe("App's card answer boxes", () => {
	let testing: Testing;
	let microphone: FakeMicrophone;

	beforeEach(() => {
		testing = new Testing();
		microphone = new FakeMicrophone();
		testing.dictation = new Dictation(
			microphone,
			async () => new FakeDictationLink(),
		);
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		testing.dictation?.dispose();
	});

	const asking = conversation({
		title: "Header",
		messages: [
			message("user", "fix the header"),
			message(
				"agent",
				[
					"1. Which pages need it?",
					"   - (a) Todos",
					"   - (b) Tasks",
					"2. What looks off at 390px?",
				].join("\n"),
			),
		],
	});

	const card = (view: ConversationsView, question: string) =>
		view.getByRole("listitem", { name: `question ${question}` });
	const answer = (view: ConversationsView, question: string) =>
		within(card(view, question)).getByRole("textbox") as HTMLTextAreaElement;

	it("writes what the mic hears into its own box, not the composer, saying it listens there", async () => {
		const view = await testing.openConversations([asking]);
		await waitFor(() => card(view, "2"));

		await act(async () =>
			fireEvent.click(
				within(card(view, "2")).getByRole("button", { name: "Dictate" }),
			),
		);
		const stop = await waitFor(() =>
			within(card(view, "2")).getByRole("button", { name: "Stop dictation" }),
		);
		expect(within(card(view, "2")).getByText("Recording")).toBeTruthy();
		act(() => microphone.speak(" more"));
		await waitFor(() => expect(answer(view, "2").value).toBe("something more"));
		expect(textIn(view.getByRole("textbox", { name: "Message input" }))).toBe(
			"",
		);

		await act(async () => fireEvent.click(stop));

		await waitFor(() => expect(view.queryByText("Recording")).toBeNull());
		expect(answer(view, "2").value).toBe("something more");
	});

	it("keeps an edit made mid-take, adding only what is heard after it", async () => {
		const view = await testing.openConversations([asking]);
		await waitFor(() => card(view, "2"));
		await act(async () =>
			fireEvent.click(
				within(card(view, "2")).getByRole("button", { name: "Dictate" }),
			),
		);
		const stop = await waitFor(() =>
			within(card(view, "2")).getByRole("button", { name: "Stop dictation" }),
		);
		await waitFor(() => expect(answer(view, "2").value).toBe("something"));

		await act(async () =>
			fireEvent.change(answer(view, "2"), {
				target: { value: "Something, edited" },
			}),
		);
		act(() => microphone.speak(" more"));
		await waitFor(() =>
			expect(answer(view, "2").value).toBe("Something, edited more"),
		);

		await act(async () => fireEvent.click(stop));
		await waitFor(() => expect(view.queryByText("Recording")).toBeNull());
		expect(answer(view, "2").value).toBe("Something, edited more");
	});

	it("sends the files pasted into a box with the reply, named after the answer they go with", async () => {
		const view = await testing.openConversations([asking]);
		await waitFor(() => card(view, "2"));
		const shot = new File(["png bytes"], "shot.png", { type: "image/png" });
		await act(async () =>
			fireEvent.change(answer(view, "2"), {
				target: { value: "This overlaps" },
			}),
		);

		await act(async () =>
			fireEvent.paste(answer(view, "2"), { clipboardData: { files: [shot] } }),
		);
		expect(
			within(card(view, "2")).getByRole("button", {
				name: "remove shot.png",
			}),
		).toBeTruthy();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Send" })),
		);

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{
					method: "POST",
					body: {
						text: "> **What looks off at 390px?**\n\nThis overlaps [Image 1]",
						file: [shot],
					},
				},
			]),
		);
	});

	it("answers a question with a file alone", async () => {
		const view = await testing.openConversations([asking]);
		await waitFor(() => card(view, "2"));
		const shot = new File(["png bytes"], "shot.png", { type: "image/png" });

		await act(async () =>
			fireEvent.paste(answer(view, "2"), { clipboardData: { files: [shot] } }),
		);
		const send = view.getByRole("button", {
			name: "Send",
		}) as HTMLButtonElement;
		expect(send.disabled).toBe(false);
		await act(async () => fireEvent.click(send));

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{
					method: "POST",
					body: {
						text: "> **What looks off at 390px?**\n\n[Image 1]",
						file: [shot],
					},
				},
			]),
		);
	});

	it("shows a blocked mic in the box that took it, not the composer", async () => {
		microphone.failure = new DOMException(
			"Permission denied",
			"NotAllowedError",
		);
		const view = await testing.openConversations([asking]);
		await waitFor(() => card(view, "2"));

		await act(async () =>
			fireEvent.click(
				within(card(view, "2")).getByRole("button", { name: "Dictate" }),
			),
		);

		const alert = await waitFor(() =>
			within(card(view, "2")).getByRole("alert"),
		);
		expect(alert.textContent).toContain("The mic is blocked for this page.");
		expect(view.getAllByRole("alert")).toHaveLength(1);
	});

	it("sends the files attached to a review's changes with them", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Header",
				messages: [
					message(
						"agent",
						[
							"## 🔍 Ready to merge header onto main",
							"",
							"The header wraps on phones.",
							"",
							'Reply "merge", or say what to change.',
						].join("\n"),
					),
				],
			}),
		]);
		const panel = await waitFor(() =>
			view.getByRole("region", { name: "review header" }),
		);
		const changes = within(panel).getByRole("textbox", {
			name: "Changes to header",
		});
		const shot = new File(["png bytes"], "shot.png", { type: "image/png" });

		await act(async () =>
			fireEvent.paste(changes, { clipboardData: { files: [shot] } }),
		);
		await act(async () =>
			fireEvent.click(
				within(panel).getByRole("button", { name: "Send changes" }),
			),
		);

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "[Image 1]", file: [shot] } },
			]),
		);
	});
});
