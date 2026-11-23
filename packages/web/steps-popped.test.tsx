import "./testing-dom";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	AssistantRuntimeProvider,
	type ThreadMessageLike,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import type { Steps } from "@splates/server/plans/browser";
import { ReplyContext } from "./card-reply";
import type { Exchange } from "./steps-asked";
import { Popped } from "./steps-popped";
import { typeIn } from "./testing";
import { act, cleanup, fireEvent, render, within } from "./testing-library";

describe("the Steps pop-out", () => {
	beforeEach(() => localStorage.clear());
	afterEach(cleanup);

	it("draws its chat with the conversation's own thread and composer", async () => {
		const view = render(
			<ReplyContext
				value={{
					send: async () => {},
					drafts: { read: () => "", write: () => {} },
				}}
			>
				{thread(ANSWERED, false, [ANSWER])}
			</ReplyContext>,
		);

		const chat = within(view.container).getByRole("region", { name: "Chat" });
		expect(chat.querySelector("[data-slot=aui_thread-viewport]")).toBeTruthy();
		expect(
			chat.querySelector("[data-slot=aui_user-message-root]")?.textContent,
		).toContain("No Roll button.");
		expect(
			chat.querySelector("[data-slot=aui_assistant-message-root]")?.textContent,
		).toContain("It's in the ⋯ menu.");
		const ask = within(view.container).getByRole("group", { name: "Ask" });
		expect(
			ask.querySelector("[data-slot=aui_composer-root], form"),
		).toBeTruthy();
	});

	it("closes the window once Done is sent", async () => {
		const sent: string[] = [];
		let closed = false;
		const view = render(
			<ReplyContext
				value={{
					send: async (text) => {
						sent.push(text);
					},
					drafts: { read: () => "", write: () => {} },
				}}
			>
				{popped({
					onClose: () => {
						closed = true;
					},
				})}
			</ReplyContext>,
		);
		const box = within(view.container);

		await act(async () =>
			fireEvent.click(box.getByRole("button", { name: "Done" })),
		);
		await act(async () =>
			fireEvent.click(box.getByRole("button", { name: "I'm done" })),
		);

		expect(sent).toHaveLength(1);
		expect(closed).toBe(true);
	});

	it("names the step the person is on in its box, and offers no box where nothing can be sent", () => {
		const view = render(
			<ReplyContext
				value={{
					send: async () => {},
					drafts: { read: () => "", write: () => {} },
				}}
			>
				{popped()}
			</ReplyContext>,
		);
		expect(view.container.textContent).toContain("Ask about step 2…");
		cleanup();

		const alone = render(popped());

		expect(
			within(alone.container).queryByRole("button", { name: "Send" }),
		).toBeNull();
	});

	it("opens on the steps, with Chat folded to a bar naming the last answer", () => {
		const view = render(
			thread(ANSWERED, false, [ANSWER], { last: "It's in the ⋯ menu." }),
		);
		const bar = chatBar(view.container);

		expect(bar.getAttribute("aria-expanded")).toBe("false");
		expect(bar.textContent).toContain("It's in the ⋯ menu.");
		expect(within(view.container).getByRole("list").textContent).toContain(
			"Open the dashboard.",
		);
	});

	it("opens Chat from its bar, and folds it again", async () => {
		const view = render(popped());
		const bar = chatBar(view.container);

		await act(async () => fireEvent.click(bar));
		expect(bar.getAttribute("aria-expanded")).toBe("true");
		await act(async () => fireEvent.click(bar));
		expect(bar.getAttribute("aria-expanded")).toBe("false");
	});

	it("keeps Chat folded while composing and opens it on send", async () => {
		const view = render(
			<ReplyContext
				value={{
					send: async () => {},
					drafts: { read: () => "", write: () => {} },
				}}
			>
				{popped()}
			</ReplyContext>,
		);

		const ask = within(view.container).getByRole("group", { name: "Ask" });
		const composer = within(ask).getByRole("textbox");
		const bar = chatBar(view.container);

		await act(async () => composer.focus());
		expect(bar.getAttribute("aria-expanded")).toBe("false");
		await typeIn(composer, "Where is the copy button?");
		expect(bar.getAttribute("aria-expanded")).toBe("false");

		await act(async () =>
			fireEvent.click(
				within(ask).getByRole("button", { name: "Send message" }),
			),
		);
		expect(chatBar(view.container).getAttribute("aria-expanded")).toBe("true");
	});

	it("folds Chat when a step is marked done, unless an answer came since it was looked at", async () => {
		const view = render(thread(ASKED, true, [QUESTION]));
		const bar = () => chatBar(view.container);
		expect(bar().getAttribute("aria-expanded")).toBe("true");

		// The answer comes while Chat is open, and nobody has touched it.
		view.rerender(thread(ANSWERED, false, [ANSWER]));
		view.rerender(thread(ANSWERED, false, [ANSWER], { done: 2 }));
		expect(bar().getAttribute("aria-expanded")).toBe("true");

		// Once looked at, the next step done goes back to the steps.
		await act(async () =>
			fireEvent.pointerDown(
				within(view.container).getByRole("region", { name: "Chat" }),
			),
		);
		view.rerender(thread(ANSWERED, false, [ANSWER], { done: 3 }));
		expect(bar().getAttribute("aria-expanded")).toBe("false");
	});

	it("folds Chat when the agent sends the steps again, marking the new answer", async () => {
		const view = render(thread(ASKED, true, [QUESTION]));

		view.rerender(thread(ANSWERED, false, [ANSWER], { versions: 2 }));

		const bar = chatBar(view.container);
		expect(bar.getAttribute("aria-expanded")).toBe("false");
		expect(within(bar).getByRole("img", { name: "New answer" })).toBeTruthy();

		// Its bar still opens it, and the answer is no longer new.
		await act(async () => fireEvent.click(bar));
		expect(bar.getAttribute("aria-expanded")).toBe("true");
	});

	it("closes from its Close button", async () => {
		const closed: string[] = [];
		const view = render(popped({ onClose: () => closed.push("closed") }));

		await act(async () =>
			fireEvent.click(
				within(view.container).getByRole("button", { name: "Close" }),
			),
		);
		expect(closed).toEqual(["closed"]);
	});
});

function chatBar(container: HTMLElement): HTMLElement {
	const chat = within(container).getByRole("region", { name: "Chat" });
	return chat.querySelector("button[aria-expanded]") as HTMLElement;
}

const ASKED: ThreadMessageLike[] = [
	{ id: "u1", role: "user", content: "No Roll button." },
];
const ANSWERED: ThreadMessageLike[] = [
	...ASKED,
	{
		id: "a1",
		role: "assistant",
		content: [{ type: "text", text: "It's in the ⋯ menu." }],
	},
];
const QUESTION: Exchange = { id: "u1", step: 2, messages: [0], waiting: true };
const ANSWER: Exchange = { ...QUESTION, messages: [0, 1], waiting: false };

const STEPS: Steps = {
	title: "Rotate the secret",
	intro: "",
	steps: ["Open the dashboard.", "Copy the secret.", "Store it."],
	outro: "",
};

function popped(props: Partial<Parameters<typeof Popped>[0]> = {}) {
	return thread([], false, [], props);
}

function bare(props: Partial<Parameters<typeof Popped>[0]> = {}) {
	return (
		<Popped
			steps={STEPS}
			done={1}
			place={() => {}}
			move={() => {}}
			preview={null}
			togglePreview={() => {}}
			changed={new Map()}
			exchanges={[]}
			last={null}
			versions={1}
			window={window}
			onClose={() => {}}
			{...props}
		/>
	);
}

/** The pop-out over a thread holding `messages`, as the page runs it. */
function thread(
	messages: ThreadMessageLike[],
	running: boolean,
	exchanges: Exchange[],
	props: Partial<Parameters<typeof Popped>[0]> = {},
) {
	return (
		<InThread
			messages={messages}
			running={running}
			exchanges={exchanges}
			props={props}
		/>
	);
}

function InThread({
	messages,
	running,
	exchanges,
	props,
}: {
	messages: ThreadMessageLike[];
	running: boolean;
	exchanges: Exchange[];
	props: Partial<Parameters<typeof Popped>[0]>;
}) {
	const runtime = useExternalStoreRuntime({
		messages,
		isRunning: running,
		convertMessage: (message: ThreadMessageLike) => message,
		onNew: async () => {},
	});
	return (
		<AssistantRuntimeProvider runtime={runtime}>
			{bare({ exchanges, ...props })}
		</AssistantRuntimeProvider>
	);
}
