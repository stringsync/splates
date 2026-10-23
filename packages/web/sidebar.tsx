import type { JSX, KeyboardEvent, PointerEvent } from "react";
import { Dispatcher, type Eventful } from "webappwiz/events";

export type SidebarEvents = { changed: undefined };

/** Where the sidebar's width is kept between visits. */
const WIDTH = "splates.sidebarWidth";
/** Where a hidden sidebar is kept hidden between visits. */
const HIDDEN = "splates.sidebarHidden";
/** Where folded pages are kept folded between visits. */
const PAGES_FOLDED = "splates.sidebarPagesFolded";

/** In pixels: the width it starts at, `w-56`, and how far it can go. */
export const DEFAULT_WIDTH = 224;
export const MIN_WIDTH = 192;
export const MAX_WIDTH = 480;

/** How far an arrow key moves the edge. */
const STEP = 16;

/**
 * Whether the sidebar shows, how wide it is, in pixels, always within
 * `MIN_WIDTH` and `MAX_WIDTH`, and whether its pages show above the
 * conversations or are folded away. `storage` keeps all three for the next
 * visit, when given.
 */
export class Sidebar implements Eventful<SidebarEvents> {
	private readonly dispatcher = new Dispatcher<SidebarEvents>();
	readonly events = this.dispatcher.events;

	width: number;
	shown: boolean;
	pagesShown: boolean;

	constructor(private readonly storage?: Storage) {
		const kept = Number(storage?.getItem(WIDTH) ?? Number.NaN);
		this.width = Number.isFinite(kept) ? clamp(kept) : DEFAULT_WIDTH;
		this.shown = (storage?.getItem(HIDDEN) ?? null) === null;
		this.pagesShown = (storage?.getItem(PAGES_FOLDED) ?? null) === null;
	}

	/** Hides it when shown and shows it when hidden, as its shortcut does. */
	toggle(): void {
		this.shown = !this.shown;
		if (this.shown) {
			this.storage?.removeItem(HIDDEN);
		} else {
			this.storage?.setItem(HIDDEN, "1");
		}
		this.dispatcher.dispatch("changed");
	}

	/** Folds the pages away when they show and unfolds them when folded. */
	togglePages(): void {
		this.pagesShown = !this.pagesShown;
		if (this.pagesShown) {
			this.storage?.removeItem(PAGES_FOLDED);
		} else {
			this.storage?.setItem(PAGES_FOLDED, "1");
		}
		this.dispatcher.dispatch("changed");
	}

	/** Moves the edge to `width`, as near as the range allows. */
	set(width: number): void {
		const next = clamp(width);
		if (next === this.width) {
			return;
		}
		this.width = next;
		this.dispatcher.dispatch("changed");
	}

	/** Keeps the width for the next visit. Call it when a drag ends. */
	keep(): void {
		if (this.width === DEFAULT_WIDTH) {
			this.storage?.removeItem(WIDTH);
		} else {
			this.storage?.setItem(WIDTH, String(this.width));
		}
	}

	reset(): void {
		this.set(DEFAULT_WIDTH);
		this.keep();
	}
}

function clamp(width: number): number {
	return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)));
}

/**
 * The sidebar's right edge, to drag wider or narrower. Arrow keys move it
 * too, and a double click puts it back.
 */
export function SidebarHandle({ sidebar }: { sidebar: Sidebar }): JSX.Element {
	const drag = (event: PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) {
			return;
		}
		// No text gets selected as the pointer sweeps over the page.
		event.preventDefault();
		const handle = event.currentTarget;
		handle.setPointerCapture(event.pointerId);
		const from = event.clientX - sidebar.width;
		const root = handle.closest<HTMLElement>("[data-sidebar-layout]");
		let width = sidebar.width;
		const move = (moved: globalThis.PointerEvent) => {
			width = clamp(moved.clientX - from);
			root?.style.setProperty("--sidebar-width", `${width}px`);
		};
		const end = () => {
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", end);
			handle.removeEventListener("pointercancel", end);
			sidebar.set(width);
			sidebar.keep();
		};
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", end);
		handle.addEventListener("pointercancel", end);
	};
	const nudge = (event: KeyboardEvent<HTMLDivElement>) => {
		const by =
			event.key === "ArrowLeft" ? -STEP : event.key === "ArrowRight" ? STEP : 0;
		if (by === 0) {
			return;
		}
		event.preventDefault();
		sidebar.set(sidebar.width + by);
		sidebar.keep();
	};
	return (
		// biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be dragged or focused as a splitter.
		<div
			role="separator"
			aria-label="Resize sidebar"
			aria-orientation="vertical"
			aria-valuenow={sidebar.width}
			aria-valuemin={MIN_WIDTH}
			aria-valuemax={MAX_WIDTH}
			tabIndex={0}
			title="Drag to resize, double-click to reset"
			onPointerDown={drag}
			onKeyDown={nudge}
			onDoubleClick={() => sidebar.reset()}
			className="fixed inset-y-0 left-(--sidebar-width) z-50 w-2 -translate-x-1/2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors hover:after:bg-ring focus-visible:after:bg-ring active:after:bg-ring"
		/>
	);
}
