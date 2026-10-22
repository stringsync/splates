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
	resize,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's card answer box after a take", () => {
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
		resize(1024, 768);
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
		within(card(view, question)).getByRole("textbox");

	let view: ConversationsView;

	beforeEach(async () => {
		view = await testing.openConversations([asking]);
		await waitFor(() => card(view, "2"));
	});

	it("gives the box its focus back once the take is stopped", async () => {
		// A click focuses the mic, as in a browser.
		const mic = within(card(view, "2")).getByRole("button", {
			name: "Dictate",
		});
		mic.focus();
		await act(async () => fireEvent.click(mic));
		const stop = await waitFor(() =>
			within(card(view, "2")).getByRole("button", { name: "Stop dictation" }),
		);
		act(() => microphone.speak("hello"));
		await act(async () => fireEvent.click(stop));
		await waitFor(() => expect(view.queryByText("Recording")).toBeNull());
		await act(() => new Promise((done) => requestAnimationFrame(done)));
		expect(document.activeElement).toBe(answer(view, "2"));
	});
});
