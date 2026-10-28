"use client";

import {
	AuiIf,
	ComposerPrimitive,
	type TriggerAdapter,
	type TriggerMatcher,
	type Unstable_DirectiveFormatter,
	useAui,
	useAuiState,
} from "@assistant-ui/react";
import { LexicalComposerInput } from "@assistant-ui/react-lexical";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import {
	type FC,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ForgetAttachment } from "#web/attachment-chips.tsx";
import { ChipKeysPlugin } from "#web/chip-keys.tsx";
import { ComposerAddAttachment } from "#web/components/assistant-ui/elements/attachment.aui.tsx";
import { ThreadExtrasContext } from "#web/components/assistant-ui/elements/thread-context.aui.ts";
import {
	CategoryList,
	CommandList,
	MentionRow,
	POPOVER_LIST,
	POPOVER_ROW,
	type PopoverKey,
	PopoverKeys,
	ReferenceList,
	steadyPointer,
} from "#web/components/assistant-ui/elements/thread-popovers.aui.tsx";
import { TooltipIconButton } from "#web/components/assistant-ui/elements/tooltip-icon-button.tsx";
import { Button } from "#web/components/ui/button.tsx";
import {
	ComposerChip,
	chipFormatter,
	FileNames,
} from "#web/composer-chips.tsx";
import {
	AttachmentChipsPlugin,
	CaretInPlacePlugin,
	type ChipWriter,
	ChipWriterPlugin,
	focusComposer,
	KeyboardDownOnTouchPlugin,
	PasteFilesPlugin,
	TypedDirectivesPlugin,
	useSlashFocusesComposer,
} from "#web/composer-editor.tsx";
import { DictateButton } from "#web/dictate-button.tsx";
import { DictationContext } from "#web/dictation-context.ts";
import { DictationNotice, DictationStatus } from "#web/dictation-status.tsx";
import { distinctNames } from "#web/file-chip.tsx";
import { useTouch } from "#web/hooks/use-touch.ts";
import { cn } from "#web/lib/utils.ts";
import { filesIn, NamedContext } from "#web/mentioned.tsx";
import { PendingSpinner, useShowPending } from "#web/pending.tsx";

/** What a tap in the composer's box works itself, rather than the editor. */
const CONTROL = "button, a, input, textarea, [contenteditable], [role=option]";

export const Composer: FC<{ autoFocus: boolean }> = ({ autoFocus }) => {
	const {
		mentions,
		references,
		commands,
		placeholder = "Send a message...",
	} = useContext(ThreadExtrasContext);
	const popoverKeys = useRef<PopoverKey | null>(null);
	const [pointer] = useState(steadyPointer);
	const writer = useRef<ChipWriter | null>(null);
	const named = useContext(NamedContext);
	const formatter = useMemo(() => chipFormatter(named), [named]);
	const text = useAuiState((s) => s.composer.text);
	const names = useMemo(
		() => distinctNames(filesIn(text, named)),
		[text, named],
	);
	const mentioned = useMemo(
		() => (mentions === undefined ? undefined : matching(mentions)),
		[mentions],
	);
	// A phone's keyboard has no Shift for a new line, so its Return types one
	// and Send sends.
	const touch = useTouch();
	const sendDictation = useDictationSend();
	const dictating = useAuiState((s) => s.composer.dictation != null);
	useSlashFocusesComposer();
	useEnterSendsDictation(dictating && !touch, sendDictation);
	const composer = (
		<ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
			<ComposerPrimitive.AttachmentDropzone
				render={
					// A tap in the box that misses its controls still lands in the
					// editor, as a textarea's padding would: on a phone the line
					// being typed on is a small part of the box. The controls take a
					// line of their own below the input, however wide the box, so a
					// conversation under way looks as a new one does.
					// biome-ignore lint/a11y/noStaticElementInteractions: a pointer convenience; the editor itself takes the keyboard
					// biome-ignore lint/a11y/useKeyWithClickEvents: as above
					<div
						onClick={(event) => {
							const target = event.target as Element;
							// A click in a dialog portaled from a chip, such as the
							// annotator's, bubbles here through React, not the page.
							if (
								event.currentTarget.contains(target) &&
								!target.closest(CONTROL)
							) {
								focusComposer(event.currentTarget);
							}
						}}
						data-slot="aui_composer-shell"
						className="border-foreground/10 focus-within:border-foreground/25 data-[dragging=true]:border-ring flex w-full cursor-text [view-transition-name:composer] flex-wrap items-end [&>.dictation-notice]:basis-full rounded-(--composer-radius) border bg-(--composer-bg) p-(--composer-padding) transition-[border-color] data-[dragging=true]:border-dashed data-[dragging=true]:bg-[color-mix(in_oklab,var(--color-accent)_50%,var(--color-background))]"
					/>
				}
			>
				<ForgetAttachment value={(at) => writer.current?.forget(at)}>
					<FileNames value={names}>
						<LexicalComposerInput
							placeholder={placeholder}
							className="aui-composer-input caret-primary relative max-h-48 min-h-10 min-w-0 basis-full pointer-coarse:max-h-32 bg-transparent px-2.5 text-base leading-6 [&_.aui-lexical-input]:min-h-10 [&_.aui-lexical-input]:py-2 [&_.aui-lexical-input]:outline-none [&_.aui-lexical-placeholder]:pointer-events-none [&_.aui-lexical-placeholder]:absolute [&_.aui-lexical-placeholder]:top-2 [&_.aui-lexical-placeholder]:left-2.5 [&_.aui-lexical-placeholder]:text-muted-foreground/60"
							autoFocus={autoFocus}
							submitMode={touch ? "none" : "enter"}
							aria-label="Message input"
							formatter={formatter}
							directiveChip={ComposerChip}
							directivePluginProps={{
								onDirectiveSelect: () => writer.current?.space(),
							}}
						>
							<ChipWriterPlugin writer={writer} />
							<PasteFilesPlugin />
							<AttachmentChipsPlugin />
							<ChipKeysPlugin />
							<TypedDirectivesPlugin />
							<KeyboardDownOnTouchPlugin />
							<CaretInPlacePlugin />
						</LexicalComposerInput>
					</FileNames>
				</ForgetAttachment>
				<ComposerAction />
				<DictationNotice />
			</ComposerPrimitive.AttachmentDropzone>
		</ComposerPrimitive.Root>
	);
	if (
		mentions === undefined &&
		references === undefined &&
		commands === undefined
	) {
		return composer;
	}
	return (
		<PopoverKeys.Provider value={popoverKeys}>
			<ComposerPrimitive.TriggerPopoverRoot>
				{/* The lists float over the thread above the composer, held to the
			    composer's edges, so opening one moves nothing. A key the open
			    list takes stops here, on the way down, before the box sees it,
			    and so does a move of a pointer resting on the list. */}
				<div
					className="relative w-full"
					onMouseMoveCapture={(event) => {
						if (
							!pointer.moved(event.clientX, event.clientY) &&
							event.target instanceof Element &&
							event.target.closest('[role="listbox"]') !== null
						) {
							event.stopPropagation();
						}
					}}
					onKeyDownCapture={(event) => {
						pointer.keyed();
						if (popoverKeys.current?.(event) === true) {
							event.preventDefault();
							event.stopPropagation();
						}
					}}
				>
					{mentions !== undefined && (
						<ComposerPrimitive.TriggerPopover
							char="@"
							matcher={mentioned}
							adapter={mentions}
							className="absolute inset-x-0 bottom-full z-10 mb-2"
						>
							<ComposerPrimitive.TriggerPopover.Directive
								formatter={PLAIN_MENTION}
							/>
							<ComposerPrimitive.TriggerPopoverItems>
								{(items) => (
									<div aria-label="mentions" className={POPOVER_LIST}>
										{items.map((item, index) => (
											<ComposerPrimitive.TriggerPopoverItem
												key={item.id}
												item={item}
												index={index}
												className={cn(POPOVER_ROW, "font-mono text-xs")}
											>
												<MentionRow path={item.label} />
											</ComposerPrimitive.TriggerPopoverItem>
										))}
									</div>
								)}
							</ComposerPrimitive.TriggerPopoverItems>
						</ComposerPrimitive.TriggerPopover>
					)}
					{references !== undefined && (
						<ComposerPrimitive.TriggerPopover
							char="#"
							matcher={NOT_IN_DIRECTIVE}
							adapter={references.adapter}
							aria-label="references"
							className="absolute inset-x-0 bottom-full z-10 mb-2"
						>
							{/* Nothing of the `#` stays: a directive goes in as a chip,
						    an action only runs. */}
							<ComposerPrimitive.TriggerPopover.Action
								onExecute={references.pick}
								removeOnExecute
							/>
							<ComposerPrimitive.TriggerPopoverCategories>
								{(categories) => <CategoryList categories={categories} />}
							</ComposerPrimitive.TriggerPopoverCategories>
							<ComposerPrimitive.TriggerPopoverItems>
								{(items) => (
									<ReferenceList
										items={items}
										references={references}
										writer={writer}
									/>
								)}
							</ComposerPrimitive.TriggerPopoverItems>
						</ComposerPrimitive.TriggerPopover>
					)}
					{commands !== undefined && (
						<ComposerPrimitive.TriggerPopover
							char="/"
							matcher={AT_START}
							adapter={commands}
							className="absolute inset-x-0 bottom-full z-10 mb-2"
						>
							<ComposerPrimitive.TriggerPopover.Directive
								formatter={PLAIN_COMMAND}
							/>
							<ComposerPrimitive.TriggerPopoverItems>
								{(items) => <CommandList items={items} />}
							</ComposerPrimitive.TriggerPopoverItems>
						</ComposerPrimitive.TriggerPopover>
					)}
					{composer}
				</div>
			</ComposerPrimitive.TriggerPopoverRoot>
		</PopoverKeys.Provider>
	);
};
/**
 * A `/` only at the very start of the message, where an agent reads it as a
 * command, so one in a path or a sentence stays a character.
 */
const AT_START: TriggerMatcher = (text, _char, cursor) => {
	const typed = /^\/(\S*)$/.exec(text.slice(0, cursor));
	return typed === null
		? null
		: { query: typed[1] ?? "", offset: 0, endOffset: cursor };
};
/**
 * An `@` at the start or after a space, as typed, while some file matches
 * what follows it: none matches the one written in for a file's chip, with
 * the caret right after it, where an open list, even one with nothing in it,
 * would show an empty box over the composer and take the Enter that sends.
 */
const matching =
	(mentions: TriggerAdapter): TriggerMatcher =>
	(text, _char, cursor) => {
		const typed = /(^|\s)@(\S*)$/.exec(text.slice(0, cursor));
		const query = typed?.[2] ?? "";
		return typed === null || (mentions.search?.(query).length ?? 0) === 0
			? null
			: { query, offset: cursor - query.length - 1, endOffset: cursor };
	};
/**
 * A `#` at the start or after a space, as typed, but not the one in a todo's
 * `[SPLATES TASK #N]` just before the caret, which a chip reads as.
 */
const NOT_IN_DIRECTIVE: TriggerMatcher = (text, _char, cursor) => {
	const typed = /(^|\s)#([^\s#\]]*)$/.exec(text.slice(0, cursor));
	const query = typed?.[2] ?? "";
	return typed === null
		? null
		: { query, offset: cursor - query.length - 1, endOffset: cursor };
};
/** A command written as `/name`, the way the agent reads it. */
const PLAIN_COMMAND: Unstable_DirectiveFormatter = {
	serialize: (item) => `/${item.id}`,
	parse: (text) => [{ kind: "text", text }],
};
/** A mention written as `@path`, the way agents read a file reference. */
const PLAIN_MENTION: Unstable_DirectiveFormatter = {
	serialize: (item) => `@${item.id}`,
	parse: (text) => [{ kind: "text", text }],
};
const ComposerAction: FC = () => {
	// The stop control only cancels the send while no run it could stop is going.
	const isSending = useAuiState(
		(s) =>
			s.composer.submission !== undefined &&
			!(s.thread.isRunning && s.thread.capabilities.cancel),
	);

	const {
		controls,
		stopping = false,
		starting = false,
	} = useContext(ThreadExtrasContext);
	const showStarting = useShowPending(starting);
	const sendDictation = useDictationSend();
	const dictating = useAuiState((s) => s.composer.dictation != null);

	return (
		<div className="aui-composer-action-wrapper relative flex min-h-10 min-w-0 basis-full flex-nowrap items-center justify-between gap-2">
			<div
				className={cn(
					"flex min-w-0 max-w-full items-center gap-0 overflow-hidden",
					dictating && "flex-1",
				)}
			>
				{/* While a take is under way, what the mic is doing takes the
				    row's left side, where there is room to say it. */}
				<AuiIf
					condition={(s) => dictating || s.thread.capabilities.attachments}
				>
					<ComposerAddAttachment />
				</AuiIf>
				{dictating ? <DictationStatus expanded className="pr-0" /> : controls}
			</div>
			<div className="ml-auto flex shrink-0 items-center gap-1.5">
				<AuiIf condition={(s) => s.thread.capabilities.dictation}>
					<DictateButton />
				</AuiIf>
				{dictating && (
					<TooltipIconButton
						tooltip="Send message"
						side="bottom"
						type="button"
						variant="default"
						size="icon"
						className="aui-composer-send size-7 rounded-full pointer-coarse:size-11"
						aria-label="Send message"
						onClick={() => void sendDictation()}
					>
						<ArrowUpIcon />
					</TooltipIconButton>
				)}
				<AuiIf
					condition={(s) =>
						!dictating &&
						(!s.composer.canCancel ||
							(s.thread.capabilities.queue && !s.composer.isEmpty) ||
							(s.thread.voice !== undefined &&
								s.composer.submission === undefined))
					}
				>
					<ComposerPrimitive.Send
						disabled={starting}
						render={
							<TooltipIconButton
								tooltip={starting ? "Starting…" : "Send message"}
								side="bottom"
								type="button"
								variant="default"
								size="icon"
								className="aui-composer-send size-7 rounded-full pointer-coarse:size-11"
								aria-label={starting ? "Starting…" : "Send message"}
								aria-busy={starting}
							/>
						}
					>
						{showStarting ? (
							<PendingSpinner shown className="size-4 pointer-coarse:size-5" />
						) : (
							<ArrowUpIcon className="aui-composer-send-icon size-4 pointer-coarse:size-5" />
						)}
					</ComposerPrimitive.Send>
				</AuiIf>
				<AuiIf
					condition={(s) =>
						!dictating &&
						s.composer.canCancel &&
						!(s.thread.capabilities.queue && !s.composer.isEmpty) &&
						(s.thread.voice === undefined ||
							s.composer.submission !== undefined)
					}
				>
					<ComposerPrimitive.Cancel
						render={
							<Button
								type="button"
								variant="destructive"
								size="icon"
								className="aui-composer-cancel size-7 rounded-full pointer-coarse:size-11"
								disabled={stopping}
								aria-busy={stopping}
								aria-label={
									stopping
										? "Stopping…"
										: isSending
											? "Cancel sending"
											: "Stop generating"
								}
							/>
						}
					>
						<SquareIcon className="aui-composer-cancel-icon size-3.5 pointer-coarse:size-4 fill-current" />
					</ComposerPrimitive.Cancel>
				</AuiIf>
			</div>
		</div>
	);
};

/**
 * Where Enter is the focused element's own while a take is under way: a field
 * typed in, a menu or list picking from, or a dialog over the conversation.
 */
const OWN_ENTER =
	"input, textarea, select, [role=menu], [role=listbox], [role=combobox], [role=dialog], [role=alertdialog]";

/**
 * Enter sends a take under way from wherever focus sits: clicking the mic
 * leaves it on the page, not the editor, once the button swaps for Stop, and
 * the shortcut leaves it where it was, as on the sidebar row that opened the
 * conversation. A field, menu or dialog keeps its own Enter.
 */
function useEnterSendsDictation(active: boolean, send: () => Promise<void>) {
	const sending = useRef(send);
	sending.current = send;
	useEffect(() => {
		if (!active) return;
		const press = (event: KeyboardEvent) => {
			const target = event.target;
			if (
				event.key !== "Enter" ||
				event.shiftKey ||
				event.isComposing ||
				!(target instanceof HTMLElement) ||
				(!target.isContentEditable && target.closest(OWN_ENTER) !== null)
			) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			void sending.current();
		};
		window.addEventListener("keydown", press, true);
		return () => window.removeEventListener("keydown", press, true);
	}, [active]);
}

/** Finish the take before assistant-ui sends, which otherwise cancels it. */
function useDictationSend() {
	const aui = useAui();
	const dictation = useContext(DictationContext);
	const sending = useRef(false);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	return async () => {
		if (sending.current || dictation === null) return;
		sending.current = true;
		try {
			await dictation.finish();
			if (mounted.current && dictation.state.phase === "idle")
				aui.composer.send();
		} finally {
			sending.current = false;
		}
	};
}
