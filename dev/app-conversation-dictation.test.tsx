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
	let link: CountingDictationLink;

	beforeEach(() => {
		testing = new Testing();
		microphone = new FakeMicrophone();
		link = new CountingDictationLink();
		testing.dictation = new Dictation(microphone, async () => link);
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

	it("shows a waveform without partial text, then transcribes into the message", async () => {
		const { view, box } = await composer();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Dictate" })),
		);
		const stop = await waitFor(() =>
			view.getByRole("button", { name: "Stop dictation" }),
		);
		expect(view.getByText("Recording")).toBeTruthy();
		expect(view.container.querySelector(".dictation-waveform")).not.toBeNull();
		act(() => microphone.speak(" more"));
		expect(textIn(box)).toBe("");

		await act(async () => fireEvent.click(stop));

		await waitFor(() => expect(view.queryByText("Recording")).toBeNull());
		expect(textIn(box)).toBe("something more");
	});

	it("discards a recording without transcribing, preserving the edited draft", async () => {
		const { view, box } = await composer();
		expect(view.getByRole("button", { name: "Attach files" })).toBeTruthy();
		await typeIn(box, "Keep this");
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Dictate" })),
		);
		await waitFor(() => view.getByRole("button", { name: "Stop dictation" }));
		act(() => microphone.speak(" throw away"));
		await typeIn(box, "Keep this edit");
		expect(view.queryByRole("button", { name: "Attach files" })).toBeNull();
		const discard = view.getByRole("button", { name: "Discard dictation" });
		expect(discard.querySelector(".lucide-x")).not.toBeNull();

		await act(async () => fireEvent.click(discard));

		expect(textIn(box)).toBe("Keep this edit");
		expect(microphone.open).toBe(false);
		expect(link.open).toBe(false);
		expect(link.finishes).toBe(0);
		expect(view.getByRole("button", { name: "Attach files" })).toBeTruthy();
		expect(view.getByRole("button", { name: "Dictate" })).toBeTruthy();
		expect(testing.posted(`/api/conversations/${talk.id}/prompt`)).toEqual([]);
	});

	it("discards while waiting for the microphone to start", async () => {
		microphone.speak = () => {};
		const { view } = await composer();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Dictate" })),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Discard dictation" })),
		);
		expect(testing.dictation?.state.phase).toBe("idle");
		expect(microphone.open).toBe(false);
		expect(view.getByRole("button", { name: "Attach files" })).toBeTruthy();
	});

	it("stops with Escape from the editor and keeps the transcript without sending", async () => {
		const { view, box } = await composer();
		await typeIn(box, "Please");
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Dictate" })),
		);
		await waitFor(() => view.getByRole("button", { name: "Stop dictation" }));
		act(() => microphone.speak(" more"));

		await act(async () => {
			expect(fireEvent.keyDown(box, { key: "Escape" })).toBe(false);
		});

		await waitFor(() => expect(textIn(box)).toBe("Please something more"));
		expect(microphone.open).toBe(false);
		expect(testing.posted(`/api/conversations/${talk.id}/prompt`)).toEqual([]);
		expect(fireEvent.keyDown(box, { key: "Escape" })).toBe(true);
	});

	it("stops startup with Escape as Cancel dictation does", async () => {
		microphone.speak = () => {};
		const { view } = await composer();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Dictate" })),
		);
		expect(view.getByRole("button", { name: "Cancel dictation" })).toBeTruthy();

		await act(async () => fireEvent.keyDown(window, { key: "Escape" }));

		await waitFor(() => expect(testing.dictation?.state.phase).toBe("idle"));
		expect(microphone.open).toBe(false);
	});

	it("keeps an edit made mid-take, appending the complete transcript", async () => {
		const { view, box } = await composer();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Dictate" })),
		);
		const stop = await waitFor(() =>
			view.getByRole("button", { name: "Stop dictation" }),
		);
		expect(textIn(box)).toBe("");
		await typeIn(box, "Something, edited");
		act(() => microphone.speak(" more"));
		expect(textIn(box)).toBe("Something, edited");

		await act(async () => fireEvent.click(stop));

		await waitFor(() => expect(view.queryByText("Recording")).toBeNull());
		expect(textIn(box)).toBe("Something, edited something more");
	});

	it("shows the mic beside Send, empty or typed in", async () => {
		const { view, box } = await composer();
		expect(view.getByRole("button", { name: "Dictate" })).toBeTruthy();
		expect(view.getByRole("button", { name: "Send message" })).toBeTruthy();

		await typeIn(box, "hello");

		expect(view.getByRole("button", { name: "Dictate" })).toBeTruthy();
		expect(view.getByRole("button", { name: "Send message" })).toBeTruthy();
	});

	it("keeps Send available while recording", async () => {
		const { view } = await composer();
		const send = () =>
			view.getByRole("button", { name: "Send message" }) as HTMLButtonElement;
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Dictate" })),
		);
		const stop = await waitFor(() =>
			view.getByRole("button", { name: "Stop dictation" }),
		);
		act(() => microphone.speak(" more"));
		await waitFor(() => expect(view.queryByText("Recording")).not.toBeNull());
		expect(send().disabled).toBe(false);

		await act(async () => fireEvent.click(stop));

		await waitFor(() => expect(send().disabled).toBe(false));
	});

	// scry-ignore simple-test-setup: only this test delays the final transcript; its deferred resolver belongs to this scenario
	it("keeps the draft while transcribing and sends once with the final text", async () => {
		const link = new FakeDictationLink();
		let finish: (text: string) => void = () => {};
		link.finish = () =>
			new Promise<string>((resolve) => {
				finish = resolve;
			});
		testing.dictation?.dispose();
		testing.dictation = new Dictation(microphone, async () => link);
		const { view, box } = await composer();
		await typeIn(box, "Please");
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Dictate" })),
		);
		await waitFor(() => view.getByRole("button", { name: "Stop dictation" }));
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Stop dictation" })),
		);
		expect(textIn(box)).toBe("Please");
		expect(view.getByText("Transcribing").className).toContain("sr-only");
		expect(view.container.querySelector(".dictation-waveform")).not.toBeNull();
		expect(
			view
				.getByRole("button", { name: "Transcribing" })
				.querySelector(".lucide-loader-circle"),
		).not.toBeNull();
		await act(async () => {
			fireEvent.click(view.getByRole("button", { name: "Send message" }));
			fireEvent.click(view.getByRole("button", { name: "Send message" }));
		});
		expect(testing.posted(`/api/conversations/${talk.id}/prompt`)).toEqual([]);
		await act(async () => finish("fix this."));
		await waitFor(() =>
			expect(
				testing.posted(`/api/conversations/${talk.id}/prompt`),
			).toMatchObject([
				{ body: { text: "Please fix this.", dictated: "true" } },
			]),
		);
		expect(textIn(box)).toBe("");
	});

	it("sends directly from a recording after transcription", async () => {
		const { view } = await composer();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Dictate" })),
		);
		await waitFor(() => view.getByRole("button", { name: "Stop dictation" }));
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Send message" })),
		);
		await waitFor(() =>
			expect(
				testing.posted(`/api/conversations/${talk.id}/prompt`),
			).toMatchObject([{ body: { text: "something" } }]),
		);
	});

	// scry-ignore simple-test-setup: only this send scenario needs a link that fails on finish
	it("keeps the draft instead of sending when transcription fails", async () => {
		const link = new FakeDictationLink();
		link.finish = async () => {
			throw new Error("Transcription failed");
		};
		testing.dictation?.dispose();
		testing.dictation = new Dictation(microphone, async () => link);
		const { view, box } = await composer();
		await typeIn(box, "Please");
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Dictate" })),
		);
		await waitFor(() => view.getByRole("button", { name: "Stop dictation" }));
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Send message" })),
		);
		await waitFor(() =>
			expect(view.getByRole("alert").textContent).toContain(
				"Transcription failed",
			),
		);
		expect(testing.posted(`/api/conversations/${talk.id}/prompt`)).toEqual([]);
		expect(textIn(box)).toBe("Please something");
	});

	it("keeps startup text accessible while showing a waveform and loading control", async () => {
		microphone.speak = () => {};
		const { view } = await composer();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Dictate" })),
		);
		expect(view.getByText("Starting").className).toContain("sr-only");
		expect(view.container.querySelector(".dictation-waveform")).not.toBeNull();
		expect(
			view
				.getByRole("button", { name: "Cancel dictation" })
				.querySelector(".lucide-loader-circle"),
		).not.toBeNull();
	});

	it("starts and stops a take with ⌥⌘V", async () => {
		const { view } = await composer();
		const press = () =>
			act(async () =>
				fireEvent.keyDown(window, {
					code: "KeyV",
					key: "√",
					altKey: true,
					metaKey: true,
				}),
			);

		await press();
		const stop = await waitFor(() =>
			view.getByRole("button", { name: "Stop dictation" }),
		);
		expect(stop.getAttribute("aria-pressed")).toBe("true");
		await press();

		await waitFor(() => expect(view.queryByText("Recording")).toBeNull());
		expect(view.getByRole("button", { name: "Dictate" })).toBeTruthy();
	});

	it("shows a plain stop square while it listens", async () => {
		const { view } = await composer();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Dictate" })),
		);
		const stop = await waitFor(() =>
			view.getByRole("button", { name: "Stop dictation" }),
		);
		expect(stop.querySelector(".lucide-mic")).toBeNull();
		expect(stop.querySelector(".lucide-square")).not.toBeNull();
	});

	it("asks whether the mic hears when it hears nothing", async () => {
		const { view } = await composer();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Dictate" })),
		);
		await waitFor(() => view.getByRole("button", { name: "Stop dictation" }));

		act(() => microphone.hold(0, SILENCE));

		expect(view.getByText("Can't hear you")).toBeTruthy();
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

	/** Takes "something more" into the composer, as the fake mic hears it. */
	const dictate = async (
		view: Awaited<ReturnType<typeof composer>>["view"],
	) => {
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Dictate" })),
		);
		const stop = await waitFor(() =>
			view.getByRole("button", { name: "Stop dictation" }),
		);
		act(() => microphone.speak(" more"));
		await waitFor(() => expect(view.queryByText("Recording")).not.toBeNull());
		await act(async () => fireEvent.click(stop));
		await waitFor(() => expect(view.queryByText("Recording")).toBeNull());
	};
	const send = async (view: Awaited<ReturnType<typeof composer>>["view"]) => {
		await waitFor(() =>
			expect(
				(
					view.getByRole("button", {
						name: "Send message",
					}) as HTMLButtonElement
				).disabled,
			).toBe(false),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Send message" })),
		);
	};

	it("sends a dictated message as dictated, edited after or not, marking it with a mic", async () => {
		const { view, box } = await composer();
		await dictate(view);
		await typeIn(box, " please");

		await send(view);

		await waitFor(() =>
			expect(
				testing.posted(`/api/conversations/${talk.id}/prompt`),
			).toMatchObject([{ body: { dictated: "true" } }]),
		);
		expect(view.getByRole("img", { name: "Dictated" })).toBeTruthy();
	});

	it("sends a message typed after the dictated one, or over a take emptied by hand, as typed", async () => {
		const { view, box } = await composer();
		await dictate(view);
		await send(view);
		await typeIn(box, "typed");
		await send(view);
		await dictate(view);
		await typeIn(box, "");
		await typeIn(box, "typed again");
		await send(view);

		await waitFor(() =>
			expect(
				testing.posted(`/api/conversations/${talk.id}/prompt`),
			).toHaveLength(3),
		);
		expect(
			testing
				.posted(`/api/conversations/${talk.id}/prompt`)
				.map(({ body }) => body.dictated ?? null),
		).toEqual(["true", null, null]);
	});

	it("has no mic where the browser has none to give", async () => {
		testing.dictation = null;
		const { view } = await composer();
		expect(view.queryByRole("button", { name: "Dictate" })).toBeNull();
	});
});

/** Counts explicit transcription requests while retaining the fake link's behavior. */
class CountingDictationLink extends FakeDictationLink {
	finishes = 0;

	override async finish(): Promise<string> {
		this.finishes++;
		return super.finish();
	}
}
