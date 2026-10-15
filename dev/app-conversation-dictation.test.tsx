import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FakeDictationLink, FakeMicrophone } from "webappwiz/dictate/testing";
import { Dictation, SILENCE } from "./dictation";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	Testing,
	textIn,
	typeIn,
	waitFor,
} from "./testing";

describe("App's composer mic", () => {
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

	const talk = conversation();
	const composer = async () => {
		const view = await testing.openConversations([talk]);
		const box = view.getByRole("textbox", { name: "Message input" });
		return { view, box };
	};

	it("writes what it hears into the message, saying it listens, then stops", async () => {
		const { view, box } = await composer();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Dictate" })),
		);
		const stop = await waitFor(() =>
			view.getByRole("button", { name: "Stop dictation" }),
		);
		expect(view.getByText("Listening")).toBeTruthy();
		act(() => microphone.speak(" more"));
		await waitFor(() => expect(textIn(box)).toBe("something more"));

		await act(async () => fireEvent.click(stop));

		await waitFor(() => expect(view.queryByText("Listening")).toBeNull());
		expect(textIn(box)).toBe("something more");
	});

	it("shows the mic while the message is empty, and Send once something is typed", async () => {
		const { view, box } = await composer();
		expect(view.getByRole("button", { name: "Dictate" })).toBeTruthy();
		expect(view.queryByRole("button", { name: "Send message" })).toBeNull();

		await typeIn(box, "hello");

		await waitFor(() =>
			expect(view.getByRole("button", { name: "Send message" })).toBeTruthy(),
		);
		expect(view.queryByRole("button", { name: "Dictate" })).toBeNull();
	});

	it("keeps the stop in Send's place until the take ends, though it fills the message", async () => {
		const { view } = await composer();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Dictate" })),
		);
		const stop = await waitFor(() =>
			view.getByRole("button", { name: "Stop dictation" }),
		);
		expect(view.queryByRole("button", { name: "Send message" })).toBeNull();

		await act(async () => fireEvent.click(stop));

		await waitFor(() =>
			expect(view.getByRole("button", { name: "Send message" })).toBeTruthy(),
		);
	});

	it("asks whether the mic hears when it hears nothing", async () => {
		const { view } = await composer();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Dictate" })),
		);
		await waitFor(() => view.getByRole("button", { name: "Stop dictation" }));

		act(() => microphone.hold(0, SILENCE));

		expect(view.getByText("Not hearing you. Is the mic muted?")).toBeTruthy();
	});

	it("says the mic is blocked and how to allow it, until dismissed", async () => {
		microphone.failure = new DOMException(
			"Permission denied",
			"NotAllowedError",
		);
		const { view } = await composer();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Dictate" })),
		);

		const alert = await waitFor(() => view.getByRole("alert"));
		expect(alert.textContent).toContain("The mic is blocked for this page.");
		expect(alert.textContent).toContain("then reload");

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Dismiss" })),
		);
		expect(view.queryByRole("alert")).toBeNull();
	});

	// scry-ignore simple-test-setup: only this test talks to the link, so it holds its own rather than share one every test ignores
	it("points to the Creds page when the server lacks a key", async () => {
		const link = new FakeDictationLink();
		testing.dictation?.dispose();
		testing.dictation = new Dictation(microphone, async () => link);
		const { view } = await composer();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Dictate" })),
		);
		await waitFor(() => view.getByRole("button", { name: "Stop dictation" }));

		act(() =>
			link.fail(
				"dictation needs OPENAI_API_KEY: add it on the Creds page",
				"OPENAI_API_KEY",
			),
		);

		const add = await waitFor(() =>
			view.getByRole("link", { name: "Add it on Creds" }),
		);
		expect(add.getAttribute("href")).toBe("#creds");
	});

	it("has no mic where the browser has none to give", async () => {
		testing.dictation = null;
		const { view } = await composer();
		expect(view.queryByRole("button", { name: "Dictate" })).toBeNull();
	});
});
