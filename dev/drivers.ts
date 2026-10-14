import type { ConversationsView } from "./testing";
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$isElementNode,
	act,
	fireEvent,
	getNearestEditorFromDOMNode,
	waitFor,
} from "./testing-dom";

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
