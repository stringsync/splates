import { useAui } from "@assistant-ui/react";
import {
	$isDirectiveNode,
	type DirectiveNode,
} from "@assistant-ui/react-lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
	$getSelection,
	$isElementNode,
	$isRangeSelection,
	COMMAND_PRIORITY_HIGH,
	KEY_ARROW_LEFT_COMMAND,
	KEY_ARROW_RIGHT_COMMAND,
	KEY_BACKSPACE_COMMAND,
	KEY_DELETE_COMMAND,
	type LexicalNode,
} from "lexical";
import { useEffect } from "react";
import { attachmentNumber, shelfOf } from "./attachment-chips";
import { AttachmentChips } from "./composer-editor";

/**
 * Makes each chip one unit for the keyboard: an arrow key steps the caret
 * over the whole chip, and Backspace or Delete takes the whole chip out,
 * unattaching the file when it is an attachment's.
 */
export function ChipKeysPlugin(): null {
	const [editor] = useLexicalComposerContext();
	const aui = useAui();
	useEffect(() => {
		const arrow = (backward: boolean) => (event: KeyboardEvent) => {
			if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) {
				return false;
			}
			const chip = $adjacentChip(backward);
			if (chip === null) {
				return false;
			}
			event.preventDefault();
			if (backward) {
				chip.selectPrevious();
			} else {
				chip.selectNext();
			}
			return true;
		};
		const remove = (backward: boolean) => (event: KeyboardEvent | null) => {
			const chip = $adjacentChip(backward);
			if (chip === null) {
				return false;
			}
			event?.preventDefault();
			const placed = attachmentNumber(chip.getDirectiveItem().id);
			if (chip.getDirectiveItem().type !== "attachment" || placed === null) {
				chip.remove();
				return true;
			}
			new AttachmentChips(editor).forget(placed);
			const attachment = aui.composer
				.getState()
				.attachments.filter((each) => shelfOf(each.type) === placed.shelf)[
				placed.at - 1
			];
			if (attachment !== undefined) {
				void aui.composer.attachment({ id: attachment.id }).remove();
			}
			return true;
		};
		return mergeRegister(
			editor.registerCommand(
				KEY_ARROW_LEFT_COMMAND,
				arrow(true),
				COMMAND_PRIORITY_HIGH,
			),
			editor.registerCommand(
				KEY_ARROW_RIGHT_COMMAND,
				arrow(false),
				COMMAND_PRIORITY_HIGH,
			),
			editor.registerCommand(
				KEY_BACKSPACE_COMMAND,
				remove(true),
				COMMAND_PRIORITY_HIGH,
			),
			editor.registerCommand(
				KEY_DELETE_COMMAND,
				remove(false),
				COMMAND_PRIORITY_HIGH,
			),
		);
	}, [editor, aui]);
	return null;
}
/**
 * The chip a collapsed caret touches on its `backward` or forward side, even
 * from inside its element or at the edge of the text beside it; null when
 * none, or when the selection spans a range.
 */
function $adjacentChip(backward: boolean): DirectiveNode | null {
	const selection = $getSelection();
	if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
		return null;
	}
	const { anchor } = selection;
	const node = anchor.getNode();
	let next: LexicalNode | null = null;
	if ($isDirectiveNode(node)) {
		// The caret has been put on the chip itself: it is in the middle of it.
		return node;
	}
	if ($isElementNode(node)) {
		next = node.getChildAtIndex(backward ? anchor.offset - 1 : anchor.offset);
	} else if (
		backward ? anchor.offset === 0 : anchor.offset === node.getTextContentSize()
	) {
		next = backward ? node.getPreviousSibling() : node.getNextSibling();
	}
	return $isDirectiveNode(next) ? next : null;
}
