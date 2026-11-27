import { useAui } from "@assistant-ui/react";
import {
	$isDirectiveNode,
	type DirectiveNode,
} from "@assistant-ui/react-lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $dfs, mergeRegister } from "@lexical/utils";
import {
	$addUpdateTag,
	$getSelection,
	$isElementNode,
	$isRangeSelection,
	COMMAND_PRIORITY_HIGH,
	COMMAND_PRIORITY_LOW,
	CONTROLLED_TEXT_INSERTION_COMMAND,
	CUT_COMMAND,
	DELETE_CHARACTER_COMMAND,
	DELETE_LINE_COMMAND,
	DELETE_WORD_COMMAND,
	type EditorState,
	INSERT_LINE_BREAK_COMMAND,
	INSERT_PARAGRAPH_COMMAND,
	KEY_ARROW_LEFT_COMMAND,
	KEY_ARROW_RIGHT_COMMAND,
	KEY_BACKSPACE_COMMAND,
	KEY_DELETE_COMMAND,
	type LexicalNode,
	PASTE_COMMAND,
	REMOVE_TEXT_COMMAND,
} from "lexical";
import { useEffect } from "react";
import { attachmentNumber, type Placed, shelfOf } from "./attachment-chips";
import { AttachmentChips } from "./composer-editor";

/**
 * Makes each chip one unit for the keyboard, and keeps composer attachments
 * in step when any edit removes their chips: an arrow key steps the caret over
 * the whole chip, Backspace, Delete or a mobile character delete takes an
 * adjacent chip out, and deleting, cutting or replacing over chips unattaches
 * their files and renumbers the rest.
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
				$addUpdateTag(USER_EDIT_TAG);
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
		const markEdit = () => {
			$addUpdateTag(USER_EDIT_TAG);
			return false;
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
			editor.registerCommand(
				DELETE_CHARACTER_COMMAND,
				(backward) => remove(backward)(null),
				COMMAND_PRIORITY_HIGH,
			),
			editor.registerCommand(
				DELETE_WORD_COMMAND,
				markEdit,
				COMMAND_PRIORITY_HIGH,
			),
			editor.registerCommand(
				DELETE_LINE_COMMAND,
				markEdit,
				COMMAND_PRIORITY_HIGH,
			),
			editor.registerCommand(
				REMOVE_TEXT_COMMAND,
				markEdit,
				COMMAND_PRIORITY_HIGH,
			),
			editor.registerCommand(CUT_COMMAND, markEdit, COMMAND_PRIORITY_HIGH),
			editor.registerCommand(
				CONTROLLED_TEXT_INSERTION_COMMAND,
				markEdit,
				COMMAND_PRIORITY_HIGH,
			),
			editor.registerCommand(
				INSERT_LINE_BREAK_COMMAND,
				markEdit,
				COMMAND_PRIORITY_HIGH,
			),
			editor.registerCommand(
				INSERT_PARAGRAPH_COMMAND,
				markEdit,
				COMMAND_PRIORITY_HIGH,
			),
			editor.registerCommand(PASTE_COMMAND, markEdit, COMMAND_PRIORITY_LOW),
			editor.registerUpdateListener(
				({ editorState, prevEditorState, tags }) => {
					if (!tags.has(USER_EDIT_TAG)) {
						return;
					}
					const dropped = droppedAttachments(prevEditorState, editorState);
					if (dropped.length === 0) {
						return;
					}
					const state = aui.composer.getState().attachments;
					const ids = dropped.flatMap(({ shelf, at }) => {
						const found = state.filter((each) => shelfOf(each.type) === shelf)[
							at - 1
						];
						return found === undefined ? [] : [found.id];
					});
					const chips = new AttachmentChips(editor);
					for (const placed of [...dropped].sort(
						(one, other) => other.at - one.at,
					)) {
						chips.forget(placed);
					}
					for (const id of ids) {
						void aui.composer.attachment({ id }).remove();
					}
				},
			),
		);
	}, [editor, aui]);
	return null;
}

/** Attachments named by chips in `before` that have no chip left in `after`. */
function droppedAttachments(before: EditorState, after: EditorState): Placed[] {
	const kept = new Set(
		placedIn(after).map(({ shelf, at }) => `${shelf}:${at}`),
	);
	const seen = new Set<string>();
	return placedIn(before).filter(({ shelf, at }) => {
		const key = `${shelf}:${at}`;
		if (kept.has(key) || seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}

function placedIn(state: EditorState): Placed[] {
	return state.read(() =>
		$dfs()
			.map(({ node }) => node)
			.filter($isDirectiveNode)
			.filter((node) => node.getDirectiveItem().type === "attachment")
			.flatMap((node) => {
				const placed = attachmentNumber(node.getDirectiveItem().id);
				return placed === null ? [] : [placed];
			}),
	);
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

/** Marks a Lexical update driven by a user edit command in the composer. */
const USER_EDIT_TAG = "composer-user-edit";
