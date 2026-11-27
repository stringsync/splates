import "./testing-dom";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Steps } from "@splates/server/plans/browser";
import { ConversationFeed } from "./conversation-feed";
import { Drafts } from "./drafts";
import { askedFrom } from "./steps-asked";
import { StepsCard, StepsConversation } from "./steps-card";
import { StepsPopOutHost } from "./steps-pop-host";
import { conversation, message, Testing } from "./testing";
import { act, cleanup, fireEvent, render, within } from "./testing-library";

describe("the Steps pop-out host", () => {
	let popped: FakeWindow;
	let testing: Testing;
	beforeEach(() => {
		testing = new Testing();
		localStorage.clear();
		popped = fakeWindow();
		(
			globalThis as { documentPictureInPicture?: unknown }
		).documentPictureInPicture = {
			requestWindow: async () => popped,
			window: null,
		};
	});
	afterEach(() => {
		cleanup();
		delete (globalThis as { documentPictureInPicture?: unknown })
			.documentPictureInPicture;
	});

	it("keeps the pop-out open when its card goes, as on opening another conversation or page", async () => {
		const view = render(page(true));
		await act(async () =>
			fireEvent.click(
				within(view.container).getByRole("button", { name: "Pop out" }),
			),
		);
		expect(popped.document.body.textContent).toContain("Open the dashboard.");

		view.rerender(page(false));

		expect(popped.closed).toBe(0);
		expect(popped.document.body.textContent).toContain("Open the dashboard.");

		// Back on the conversation, its card knows it is out.
		view.rerender(page(true));
		await act(async () =>
			fireEvent.click(
				within(view.container).getByRole("button", { name: "Bring back" }),
			),
		);
		expect(popped.closed).toBe(1);
		expect(
			within(view.container).getByRole("button", { name: "Pop out" }),
		).toBeTruthy();
	});

	it("reads the conversation for itself: the steps and what was asked from the pop-out, with the answer", async () => {
		const talk = new ConversationFeed(testing.timer, testing.wall);
		talk.available = true;
		talk.put(
			conversation({
				id: "c1",
				messages: [
					message(
						"agent",
						"## 📋 Steps: Rotate the secret\n\n1. Open the dashboard.\n2. Copy the secret.\n3. Store it.",
					),
					message("user", askedFrom(STEPS, 1, "No copy button?")),
					message("agent", "It's in the ⋯ menu."),
				],
			}),
		);
		const view = render(page(true, talk));
		await act(async () =>
			fireEvent.click(
				within(view.container).getByRole("button", { name: "Pop out" }),
			),
		);

		const body = popped.document.body;
		expect(body.textContent).toContain("Open the dashboard.");
		expect(body.textContent).toContain("No copy button?");
		expect(body.textContent).toContain("It's in the ⋯ menu.");
		expect(
			body
				.querySelector("section[aria-label=Chat] > button")
				?.textContent?.includes("It's in the ⋯ menu."),
		).toBe(true);
	});

	it("closes from Close in the pop-out", async () => {
		const view = render(page(true));
		await act(async () =>
			fireEvent.click(
				within(view.container).getByRole("button", { name: "Pop out" }),
			),
		);

		// The pop-out's document has no window for fireEvent to use.
		await act(async () =>
			(
				popped.document.body.querySelector(
					"button[aria-label=Close]",
				) as HTMLElement
			).click(),
		);

		expect(popped.closed).toBe(1);
		expect(popped.document.body.textContent).toBe("");
	});
});

const STEPS: Steps = {
	title: "Rotate the secret",
	intro: "",
	steps: ["Open the dashboard.", "Copy the secret.", "Store it."],
	outro: "",
};

const TALK = new ConversationFeed();
const DRAFTS = new Drafts();

/** The page, showing the card's conversation or, with `card` false, another. */
function page(card: boolean, talk = TALK) {
	return (
		<StepsPopOutHost talk={talk} drafts={DRAFTS}>
			<StepsConversation value="c1">
				{card && <StepsCard steps={STEPS} />}
			</StepsConversation>
		</StepsPopOutHost>
	);
}

interface FakeWindow {
	document: Document;
	closed: number;
	addEventListener: (type: string, listener: () => void) => void;
	close: () => void;
}

/** A picture-in-picture window: closing it says so, as the browser's does. */
function fakeWindow(): FakeWindow {
	const hidden: (() => void)[] = [];
	const made: FakeWindow = {
		document: document.implementation.createHTMLDocument("pop-out"),
		closed: 0,
		addEventListener: (type, listener) => {
			if (type === "pagehide") {
				hidden.push(listener);
			}
		},
		close: () => {
			made.closed += 1;
			for (const each of hidden.splice(0)) {
				each();
			}
		},
	};
	return made;
}
