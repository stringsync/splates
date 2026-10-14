"use client";

import {
	ComposerPrimitive,
	type TriggerCategory,
	type TriggerItem,
	unstable_useTriggerPopoverScopeContext,
} from "@assistant-ui/react";
import { ChevronLeftIcon, ChevronRightIcon, FolderIcon } from "lucide-react";
import {
	createContext,
	type FC,
	type JSX,
	type RefObject,
	useContext,
	useEffect,
	useLayoutEffect,
	useReducer,
	useRef,
	useState,
} from "react";
import { flushSync } from "react-dom";
import { type ChipWriter } from "#dev/composer-editor.tsx";
import { FileIcon } from "#dev/file-chip.tsx";
import { cn } from "#dev/lib/utils.ts";
import { split } from "#dev/mentions.tsx";
import type { References } from "#dev/references.tsx";

/** Takes a key pressed in the composer for the open list, true if it did. */
export type PopoverKey = (event: { key: string; shiftKey: boolean }) => boolean;
/** Where the open list puts its `PopoverKey`, read by the composer. */
export const PopoverKeys = createContext<RefObject<PopoverKey | null>>({
	current: null,
});
/** How far the pointer goes after a key before a row under it takes the highlight. */
const STEADY_PX = 4;
/**
 * Keeps the highlight where the keys put it while the pointer rests on the open
 * list. A row takes the highlight on `mousemove`, which also comes as the keys
 * scroll rows under a pointer that has not moved, or one that only trembles,
 * and would move the highlight on past the row the keys were going to next.
 */
export function steadyPointer() {
	let last: { left: number; top: number } | null = null;
	let anchor: { left: number; top: number } | null = null;
	let free = false;
	return {
		/** Notes a key, after which the pointer has to move again to count. */
		keyed(): void {
			free = false;
			anchor = last;
		},
		/** Notes the pointer at `left`, `top`, true if it has moved enough to count. */
		moved(left: number, top: number): boolean {
			last = { left, top };
			if (free) {
				return true;
			}
			if (anchor === null) {
				anchor = last;
				return false;
			}
			free = Math.hypot(left - anchor.left, top - anchor.top) >= STEADY_PX;
			return free;
		},
	};
}
/**
 * A path in the `@` list: its logo, its name, then its folder, which gives way
 * first, so a long path loses its folder rather than its name.
 */
export function MentionRow({ path }: { path: string }): JSX.Element {
	const [folder, name] = split(path);
	return (
		<>
			{path.endsWith("/") ? (
				<FolderIcon
					aria-hidden
					className="size-3.5 shrink-0 text-muted-foreground"
				/>
			) : (
				<FileIcon path={path} className="size-3.5" />
			)}
			<span className="truncate">{name}</span>
			<span className="shrink-1000 truncate text-muted-foreground">
				{folder}
			</span>
		</>
	);
}
export const POPOVER_LIST =
	"bg-popover text-popover-foreground w-full max-w-md rounded-xl border p-1 shadow-md";
export const POPOVER_ROW =
	"data-[highlighted]:bg-accent flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start outline-none";
/**
 * Keeps the highlight on the row it was on when the open list's `rows` are
 * built again with that row still in them, as they are each time the board or
 * the tasks change, where assistant-ui would put it back on the first row; and
 * scrolls the row `selector` finds in `list` into view as it changes. Typing,
 * or moving to another category, still starts again on the first row.
 */
function useKeptHighlight(
	rows: readonly { id: string }[],
	list?: { ref: RefObject<HTMLElement | null>; selector: string },
): void {
	const { activeCategoryId, highlightIndex, highlightedIndex, query } =
		unstable_useTriggerPopoverScopeContext();
	const kept = useRef<{
		rows: readonly { id: string }[];
		id: string | undefined;
		query: string;
		category: string | null;
	} | null>(null);
	// Whether the row is to be highlighted again once assistant-ui has settled.
	const waiting = useRef(false);
	const [, settle] = useReducer((renders: number) => renders + 1, 0);
	const scrolled = useRef<string | null>(null);
	// Before paint, so the first row never shows highlighted between the two.
	useLayoutEffect(() => {
		const was = kept.current;
		const id = rows[highlightedIndex]?.id;
		const at =
			was !== null &&
			(was.rows !== rows || waiting.current) &&
			was.id !== id &&
			was.query === query &&
			was.category === activeCategoryId
				? rows.findIndex((row) => row.id === was.id)
				: -1;
		if (was !== null && at !== -1) {
			kept.current = { ...was, rows };
			if (waiting.current) {
				waiting.current = false;
				highlightIndex(at);
			} else {
				// `highlightIndex` still holds the row before the reset until the
				// popover's effects have run, after this one, and would take the
				// row it was on as nothing to do: render again once they have,
				// which a synchronous render does first, still before paint.
				waiting.current = true;
				queueMicrotask(() => flushSync(settle));
			}
			return;
		}
		waiting.current = false;
		kept.current = { rows, id, query, category: activeCategoryId };
		if (list !== undefined && scrolled.current !== list.selector) {
			scrolled.current = list.selector;
			list.ref.current
				?.querySelector(list.selector)
				?.scrollIntoView?.({ block: "nearest" });
		}
	});
}
/** The `#` categories, the highlight kept as the board changes. */
export const CategoryList: FC<{ categories: readonly TriggerCategory[] }> = ({
	categories,
}) => {
	useKeptHighlight(categories);
	return (
		<div className={POPOVER_LIST}>
			{categories.map((category) => (
				<ComposerPrimitive.TriggerPopoverCategoryItem
					key={category.id}
					categoryId={category.id}
					className={cn(POPOVER_ROW, "justify-between text-sm")}
				>
					{category.label}
					<ChevronRightIcon className="text-muted-foreground size-4" />
				</ComposerPrimitive.TriggerPopoverCategoryItem>
			))}
		</div>
	);
};
/**
 * What a `#` category holds, or what matches what was typed after it, the row
 * the arrow keys are on kept in view. In a category, the arrow keys reach Back
 * too, up from the first row or down from the last, and Enter or Tab on it
 * goes back to the categories.
 */
export const ReferenceList: FC<{
	items: readonly TriggerItem[];
	references: References;
	writer: RefObject<ChipWriter | null>;
}> = ({ items, references, writer }) => {
	const {
		activeCategoryId,
		goBack,
		highlightIndex,
		highlightedIndex,
		isSearchMode,
		query,
		registerSelectItemOverride,
		setCursorPosition,
	} = unstable_useTriggerPopoverScopeContext();
	const list = useRef<HTMLDivElement>(null);
	const popoverKeys = useContext(PopoverKeys);
	// Whether Back is the row the arrow keys are on, rather than an item.
	const [back, setBack] = useState(false);
	const backShown = activeCategoryId !== null && !isSearchMode;
	const onBack = back && backShown;
	// Typing, or moving to another category, starts again on the first item.
	// biome-ignore lint/correctness/useExhaustiveDependencies: resets on change
	useEffect(() => setBack(false), [query, activeCategoryId]);
	useEffect(() => {
		if (!backShown) {
			return;
		}
		const last = items.length - 1;
		popoverKeys.current = ({ key, shiftKey }) => {
			if (onBack) {
				if (key === "ArrowDown" || key === "ArrowUp") {
					setBack(false);
					highlightIndex(key === "ArrowDown" ? 0 : last);
					return true;
				}
				if ((key === "Enter" || key === "Tab") && !shiftKey) {
					goBack();
					return true;
				}
				return false;
			}
			if (
				(key === "ArrowUp" && highlightedIndex <= 0) ||
				(key === "ArrowDown" && highlightedIndex >= last)
			) {
				setBack(true);
				return true;
			}
			return false;
		};
		return () => {
			popoverKeys.current = null;
		};
	}, [
		backShown,
		onBack,
		items.length,
		highlightedIndex,
		highlightIndex,
		goBack,
		popoverKeys,
	]);
	// A system is written in as a chip, where the popover would otherwise
	// take what was typed away.
	useEffect(
		() =>
			registerSelectItemOverride((item) => {
				const chip = references.chip(item);
				return (
					chip !== null && (writer.current?.write(`#${query}`, chip) ?? false)
				);
			}),
		[registerSelectItemOverride, query, references, writer],
	);
	useKeptHighlight(items, {
		ref: list,
		selector: onBack ? "[data-back]" : `[data-index="${highlightedIndex}"]`,
	});
	return (
		<div ref={list} className={cn(POPOVER_LIST, "max-h-80 overflow-y-auto")}>
			<ComposerPrimitive.TriggerPopoverBack
				data-back=""
				data-highlighted={onBack ? "" : undefined}
				onMouseMove={() => setBack(true)}
				className={cn(POPOVER_ROW, "text-muted-foreground text-xs")}
			>
				<ChevronLeftIcon className="size-3.5" />
				Back
			</ComposerPrimitive.TriggerPopoverBack>
			{items.length === 0 && (
				<p className="text-muted-foreground px-2 py-1.5 text-sm">
					Nothing matches
				</p>
			)}
			{items.map((item, index) => (
				<ComposerPrimitive.TriggerPopoverItem
					key={item.id}
					item={item}
					index={index}
					data-index={index}
					onMouseMove={() => setBack(false)}
					className={cn(
						POPOVER_ROW,
						"text-sm [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
						onBack && "data-[highlighted]:bg-transparent",
					)}
				>
					{references.icon(item)}
					<span className="truncate">{item.label}</span>
					{item.description !== undefined && (
						// Gives way first, so the label keeps what it can.
						<span className="text-muted-foreground shrink-1000 truncate text-xs">
							{item.description}
						</span>
					)}
				</ComposerPrimitive.TriggerPopoverItem>
			))}
		</div>
	);
};
/**
 * The agent's skills and commands that match what follows the `/`, each with
 * what it does, the row the arrow keys are on kept in view.
 */
export const CommandList: FC<{ items: readonly TriggerItem[] }> = ({
	items,
}) => {
	const { highlightedIndex } = unstable_useTriggerPopoverScopeContext();
	const list = useRef<HTMLDivElement>(null);
	useKeptHighlight(items, {
		ref: list,
		selector: `[data-index="${highlightedIndex}"]`,
	});
	if (items.length === 0) {
		return null;
	}
	return (
		<div
			ref={list}
			aria-label="commands"
			className={cn(POPOVER_LIST, "max-h-80 overflow-y-auto")}
		>
			{items.map((item, index) => (
				<ComposerPrimitive.TriggerPopoverItem
					key={item.id}
					item={item}
					index={index}
					data-index={index}
					className={cn(POPOVER_ROW, "text-sm")}
				>
					<span className="shrink-0 font-mono text-xs">/{item.label}</span>
					{item.description !== undefined && (
						// Gives way first, so the name keeps what it can.
						<span className="text-muted-foreground shrink-1000 truncate text-xs">
							{item.description}
						</span>
					)}
				</ComposerPrimitive.TriggerPopoverItem>
			))}
		</div>
	);
};
