import type { TextNode } from "lexical";
import type { ConversationsView } from "./testing";
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$getSelection,
	$isElementNode,
	$isRangeSelection,
	act,
	fireEvent,
	getNearestEditorFromDOMNode,
	waitFor,
	within,
} from "./testing-dom";

/** Every agent the page lists: the phone's inbox, or the sidebar beside it. */
export function agentList(view: ConversationsView): HTMLElement {
	return (
		view.queryByRole("region", { name: "inbox" }) ??
		view.getByRole("navigation", { name: "conversations" })
	);
}

/** Opens the conversation listed by `name`, as `agentList` lists it. */
export async function openRow(
	view: ConversationsView,
	name: string,
): Promise<void> {
	const item = within(agentList(view))
		.getAllByRole("listitem")
		.flatMap((row) => within(row).getAllByRole("button"))
		.find((button) => button.textContent?.includes(name));
	if (item === undefined) {
		throw new Error(`no conversation ${name} listed`);
	}
	await act(async () => fireEvent.click(item));
}

/**
 * From the sheet a phone's inbox opens a conversation waiting on you at, to
 * its thread behind it.
 */
export async function toThread(view: ConversationsView): Promise<void> {
	const sheet = await waitFor(() => view.getByRole("dialog"));
	await act(async () =>
		fireEvent.click(
			within(sheet).getByRole("button", { name: "Conversation" }),
		),
	);
	await waitFor(() => {
		if (view.queryByRole("dialog") !== null) {
			throw new Error("the sheet is still open");
		}
	});
}

/** Opens the new conversation screen with `agent`, from the sidebar. */
export async function newWith(
	view: ConversationsView,
	agent: string,
): Promise<void> {
	await act(async () =>
		fireEvent.click(view.getByRole("button", { name: "New" })),
	);
	await act(async () =>
		fireEvent.click(
			await waitFor(() =>
				view.getByRole("menuitem", { name: new RegExp(agent) }),
			),
		),
	);
}

/**
 * Types `text` into the composer `box` in place of what it holds, the caret
 * at its end, as its editor takes typing.
 */
export function typeIn(box: HTMLElement, text: string): Promise<void> {
	return act(async () => {
		box.focus();
		editorOf(box).update(
			() => {
				const root = $getRoot().clear();
				for (const line of text.split("\n")) {
					root.append(
						$createParagraphNode().append(
							...(line === "" ? [] : [$createTextNode(line)]),
						),
					);
				}
				root.selectEnd();
			},
			{ discrete: true },
		);
	});
}

/**
 * Types `text` into the composer `box` at its caret, as its editor takes
 * typing, or with `text` empty, takes back the character before the caret.
 */
export function typeAtCaret(box: HTMLElement, text: string): Promise<void> {
	return act(async () => {
		box.focus();
		editorOf(box).update(
			() => {
				const selection = $getSelection();
				if (!$isRangeSelection(selection)) {
					throw new Error("the caret is not in the box");
				}
				if (text === "") {
					// By hand, as happy-dom gives Lexical no selection to move.
					const { anchor } = selection;
					const node = anchor.getNode() as TextNode;
					selection.setTextNodeRange(
						node,
						anchor.offset - 1,
						node,
						anchor.offset,
					);
					selection.removeText();
				} else {
					selection.insertText(text);
				}
			},
			{ discrete: true },
		);
	});
}

/** What the composer `box` holds, as its text: a chip as what it reads. */
export function textIn(box: HTMLElement): string {
	return editorOf(box)
		.getEditorState()
		.read(() =>
			$getRoot()
				.getChildren()
				.map((line) =>
					$isElementNode(line)
						? line
								.getChildren()
								.map((child) => child.getTextContent())
								.join("")
						: "",
				)
				.join("\n"),
		);
}

function editorOf(box: HTMLElement) {
	const editor = getNearestEditorFromDOMNode(box);
	if (editor === null) {
		throw new Error("not a composer");
	}
	return editor;
}

/** Picks an option of a Select: Base UI picks on the pointer let go. */
export function pick(option: HTMLElement): Promise<void> {
	return act(async () => {
		fireEvent.pointerDown(option, { pointerType: "mouse" });
		fireEvent.mouseDown(option);
		fireEvent.pointerUp(option, { pointerType: "mouse" });
		fireEvent.mouseUp(option);
		fireEvent.click(option);
	});
}

/** Presses ⌥⌘⌫, by the key's place as on a Mac. */
export function pressArchive(): Promise<void> {
	return act(async () => {
		fireEvent.keyDown(document.body, {
			code: "Backspace",
			altKey: true,
			metaKey: true,
		});
	});
}

/**
 * Opens the menu beside the project's name, unless open already, and waits
 * for its item named `name`, for a test to click or read.
 */
export async function menuItem(
	view: ConversationsView,
	name: string | RegExp,
): Promise<HTMLElement> {
	if (view.queryByRole("menu") === null) {
		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: /^More(: restart to update)?$/ }),
			),
		);
	}
	return await waitFor(() => view.getByRole("menuitem", { name }));
}

/** Sizes the window, as a phone held upright or a laptop. */
export function resize(width: number, height: number): void {
	(
		window as unknown as {
			happyDOM: { setViewport(size: { width: number; height: number }): void };
		}
	).happyDOM.setViewport({ width, height });
}

/** Opens or folds `details` as a click on its summary would. */
export function toggle(details: HTMLDetailsElement, open: boolean): void {
	act(() => {
		details.open = open;
		details.dispatchEvent(new Event("toggle"));
	});
}

/**
 * Builds every folded work row's timeline, which mounts only once its row has
 * been opened, and leaves the rows folded as they were.
 */
export function unfold(thread: HTMLElement): void {
	for (const row of thread.querySelectorAll<HTMLDetailsElement>(
		"[data-slot=work] > details",
	)) {
		if (!row.open) {
			toggle(row, true);
			toggle(row, false);
		}
	}
}

/**
 * Builds the body of every folded card in `timeline`, which mounts only once
 * the card has been opened, and leaves the cards folded as they were. Only the
 * cards there now: a card's body holds no cards of its own to build.
 */
export function unfoldCards(timeline: HTMLElement): void {
	for (const card of [
		...timeline.querySelectorAll<HTMLDetailsElement>("details"),
	]) {
		if (!card.open) {
			toggle(card, true);
			toggle(card, false);
		}
	}
}

/** The thread's work timelines, built if still folded, in order. */
export function workTimelines(thread: HTMLElement): HTMLElement[] {
	unfold(thread);
	return within(thread).getAllByRole("list", { name: "timeline" });
}

/** The thread's one work timeline. */
export function workTimeline(thread: HTMLElement): HTMLElement {
	unfold(thread);
	return within(thread).getByRole("list", { name: "timeline" });
}
