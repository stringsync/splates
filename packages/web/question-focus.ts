import { caretToEnd } from "./box-editor";

/** Puts the caret at the end of an editable question stop, leaving other stops alone. */
export function toEnd(stop: HTMLElement | null | undefined): void {
	if (stop?.isContentEditable) {
		caretToEnd(stop);
	}
}
