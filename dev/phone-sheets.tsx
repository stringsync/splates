import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
	ChevronRightIcon,
	type LucideIcon,
	MessageSquareIcon,
	XIcon,
} from "lucide-react";
import {
	createContext,
	type JSX,
	type ReactNode,
	type Ref,
	useCallback,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { raises } from "#dev/hooks/use-touch.ts";
import { useViewport } from "#dev/hooks/use-viewport.ts";
import { cn } from "#dev/lib/utils.ts";
import { lineCard } from "./board";
import { useCardReply } from "./card-reply";
import { CARD_SPACE, TONES, type Tone } from "./card-shell";
import { backTo } from "./page-address";
import { useArrived } from "./task-view";

/** A card an agent waits on you through, opened in a sheet of its own. */
interface Sheet {
	id: string;
	title: string;
	Icon: LucideIcon;
	tone: Tone;
	/** What its line and the bar call a tap on it. */
	action: string;
	/**
	 * Opens it, over the thread, or over where the page was at `from` when it
	 * came from there, going back to it on a close.
	 */
	open: (from?: string) => void;
}

/**
 * The cards in a phone's thread that wait on you, newest last: what the bar
 * above the composer opens. None beside a sidebar, where they show in full.
 */
interface Sheets {
	add(sheet: Sheet): () => void;
	shown: Sheet[];
	/** Says whether the line of card `id` is in sight in the thread. */
	sight(id: string, inView: boolean): void;
	/** The cards whose lines are in sight, which the bar leaves to them. */
	inView: ReadonlySet<string>;
}

/** How much of a card's line must show for it to stand in for the bar. */
const IN_VIEW = 0.5;

const SheetsContext = createContext<Sheets | null>(null);

/**
 * Holds the waiting cards of the thread in `children` in sheets, and opens
 * the newest once ⌥⌘M or the inbox opens this conversation for it.
 */
export function PhoneSheets({
	conversation,
	on,
	children,
}: {
	/** The conversation's id, which an arrival names. */
	conversation: string;
	/** Whether to: on a phone; beside a sidebar, cards show in full. */
	on: boolean;
	children: ReactNode;
}): JSX.Element {
	const all = useRef<Sheet[]>([]);
	// An arrival before any card came up, as while the thread loads, by the
	// address it came from: the first to come up opens.
	const arriving = useRef<string | null>(null);
	const [shown, setShown] = useState<Sheet[]>([]);
	const [inView, setInView] = useState<ReadonlySet<string>>(new Set());
	const sight = useCallback((id: string, seen: boolean) => {
		setInView((was) => {
			if (was.has(id) === seen) {
				return was;
			}
			const next = new Set(was);
			if (seen) {
				next.add(id);
			} else {
				next.delete(id);
			}
			return next;
		});
	}, []);
	const add = useCallback((sheet: Sheet) => {
		all.current = [
			...all.current.filter((each) => each.id !== sheet.id),
			sheet,
		];
		setShown(all.current);
		if (arriving.current !== null) {
			sheet.open(arriving.current);
			arriving.current = null;
		}
		return () => {
			all.current = all.current.filter((each) => each.id !== sheet.id);
			setShown(all.current);
		};
	}, []);
	const sheets = useMemo(
		() => ({ add, shown, sight, inView }),
		[add, shown, sight, inView],
	);
	// Beside a sidebar, the thread scrolls to it instead.
	useArrived(on ? conversation : "", (from) => {
		const latest = all.current.at(-1);
		if (latest === undefined) {
			arriving.current = from;
		} else {
			latest.open(from);
		}
	});
	return <SheetsContext value={on ? sheets : null}>{children}</SheetsContext>;
}

/** Whether cards open in sheets here, as in a phone's thread. */
export function useSheeted(): boolean {
	return useContext(SheetsContext) !== null;
}

/**
 * The card in `children`, while it waits on you in a phone's thread, as a
 * line saying so in the thread and the card itself in a sheet over the whole
 * screen, which that line or the bar above the composer opens. Opened from
 * elsewhere, as the inbox does, it is a moment's look: closing goes back
 * there, and only "Conversation" stays in the thread. Anywhere else, or once
 * answered, the card as it is.
 */
export function Sheeted({
	title,
	Icon,
	tone,
	action = "Answer",
	children,
}: {
	title: string;
	Icon: LucideIcon;
	tone: Tone;
	/** What a tap on its line or the bar does, "Answer" unless it asks nothing. */
	action?: string;
	children: ReactNode;
}): ReactNode {
	const sheets = useContext(SheetsContext);
	const { reply, sent } = useCardReply();
	const live = sent === null && reply?.send != null;
	const [open, setOpen] = useState(false);
	// The address it was opened from, to go back to on a close, or null.
	const from = useRef<string | null>(null);
	const show = useCallback((at?: string) => {
		from.current = at ?? null;
		setOpen(true);
	}, []);
	const close = (back: boolean) => {
		setOpen(false);
		const at = from.current;
		from.current = null;
		if (back && at !== null) {
			backTo(at);
		}
	};
	const id = useId();
	// Pinned above the keyboard, so "Anything else" stays in sight as it is typed.
	const { top, height, keyboard } = useViewport();
	const [body, setBody] = useState<HTMLDivElement | null>(null);
	useTypedInView(body, height);
	const add = sheets?.add;
	useEffect(() => {
		if (add !== undefined && live) {
			return add({ id, title, Icon, tone, action, open: show });
		}
	}, [add, live, id, title, Icon, tone, action, show]);
	const [line, setLine] = useState<HTMLButtonElement | null>(null);
	useLineInSight(line, id, sheets?.sight);
	if (sheets === null || !live) {
		return children;
	}
	return (
		<>
			<SheetLine
				ref={setLine}
				title={title}
				Icon={Icon}
				tone={tone}
				action={action}
				onOpen={() => show()}
			/>
			<DialogPrimitive.Root
				open={open}
				onOpenChange={(next) => (next ? setOpen(true) : close(true))}
			>
				<DialogPrimitive.Portal>
					<DialogPrimitive.Popup
						style={{ top, height }}
						className="fixed inset-x-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top)] outline-none transition-transform duration-200 ease-out data-ending-style:translate-y-full data-starting-style:translate-y-full"
					>
						<header className="flex h-14 shrink-0 items-center gap-2 border-b px-2">
							<DialogPrimitive.Close
								aria-label="Close"
								className="flex size-11 items-center justify-center rounded-full outline-none focus-visible:bg-muted active:bg-muted [&_svg]:size-5"
							>
								<XIcon />
							</DialogPrimitive.Close>
							<DialogPrimitive.Title className="flex-1 truncate font-semibold text-base">
								{title}
							</DialogPrimitive.Title>
							{/* Into the thread behind it, wherever it was opened from. */}
							<button
								type="button"
								onClick={() => close(false)}
								className="flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 font-medium text-muted-foreground text-sm outline-none focus-visible:bg-muted active:bg-muted [&_svg]:size-4"
							>
								<MessageSquareIcon />
								Conversation
							</button>
						</header>
						<div
							ref={setBody}
							data-sheet
							className={cn(
								// Unclipped and filling it, so a card's pinned footer sits at the sheet's foot.
								"flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain [&_[data-card]]:my-0 [&_[data-card]]:flex [&_[data-card]]:min-h-full [&_[data-card]]:shrink-0 [&_[data-card]]:flex-col [&_[data-card]]:overflow-visible [&_[data-card]]:rounded-none [&_[data-card]]:border-0 [&_[data-card]]:shadow-none [&_[data-card]]:ring-0",
								// A pinned footer sticks above its scroller's padding, letting what scrolls show beneath it, so it takes the inset itself.
								!keyboard &&
									"[&:not(:has([data-pinned]))]:pb-[env(safe-area-inset-bottom)] [&_[data-pinned]]:pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
							)}
						>
							{children}
						</div>
					</DialogPrimitive.Popup>
				</DialogPrimitive.Portal>
			</DialogPrimitive.Root>
		</>
	);
}

/**
 * Keeps the field typed in within `sheet` in sight, above whatever is pinned
 * to its foot, as the composer stays above the keyboard: as it is focused,
 * as it grows, and as the keyboard comes up and shrinks the sheet to `height`.
 */
function useTypedInView(sheet: HTMLElement | null, height: number): void {
	// The keyboard rises after the focus does, each step of it a new height.
	// biome-ignore lint/correctness/useExhaustiveDependencies: each height is the field to show again
	useEffect(() => {
		if (sheet === null) {
			return;
		}
		let frame = 0;
		// After the browser lays out what changed and pans to the focus itself.
		const later = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => reveal(sheet));
		};
		later();
		sheet.addEventListener("focusin", later);
		sheet.addEventListener("input", later);
		return () => {
			cancelAnimationFrame(frame);
			sheet.removeEventListener("focusin", later);
			sheet.removeEventListener("input", later);
		};
	}, [sheet, height]);
}

/** Room left between a field and the edge it is scrolled to. */
const MARGIN = 12;

/** Scrolls `sheet` just enough to show the field in focus whole, its foot first. */
function reveal(sheet: HTMLElement): void {
	const field = document.activeElement;
	if (
		!(field instanceof HTMLElement) ||
		!sheet.contains(field) ||
		!raises(field) ||
		// Pinned, it is always in sight.
		field.closest("[data-pinned]") !== null
	) {
		return;
	}
	const pinned =
		sheet.querySelector("[data-pinned]")?.getBoundingClientRect().height ?? 0;
	const view = sheet.getBoundingClientRect();
	const shown = field.getBoundingClientRect();
	const below = shown.bottom - (view.bottom - pinned - MARGIN);
	const above = view.top + MARGIN - shown.top;
	if (below > 0) {
		sheet.scrollTop += below;
	} else if (above > 0) {
		sheet.scrollTop -= above;
	}
}

/**
 * Above the composer of a phone's thread, the newest card waiting on you, a
 * tap from its sheet: so what needs you is never a scroll away. None while
 * that card's own line is in sight, which opens the same sheet.
 */
export function NeedsYouBar(): ReactNode {
	const sheets = useContext(SheetsContext);
	const latest = sheets?.shown.at(-1);
	if (latest === undefined || sheets?.inView.has(latest.id)) {
		return null;
	}
	// As quiet as the Archive bar beside it, the tone in its icon alone, so it
	// never outshouts the composer; the whole bar is the tap.
	const { title, Icon, tone, action, open } = latest;
	// Its own landmark, apart from the line in the thread that reads the same.
	return (
		<aside aria-label="Waiting on you">
			<button
				type="button"
				onClick={() => open()}
				className={cn(
					"group flex w-full items-center gap-2 rounded-lg border bg-card pl-3 text-left text-sm shadow-xs",
					lineCard,
				)}
			>
				<Icon className={cn("size-4 shrink-0", TONES[tone].icon)} />
				<span className="min-w-0 flex-1 truncate">{title}</span>
				<Action label={action} />
			</button>
		</aside>
	);
}

/**
 * What a tap on a waiting card's line or bar does, the same on both, so
 * either reads as the way to the sheet.
 */
function Action({ label }: { label: string }): JSX.Element {
	return (
		<span className="flex h-7 shrink-0 items-center gap-0.5 rounded-md border bg-background pr-1.5 pl-2.5 font-medium text-[0.8rem] shadow-xs group-active:bg-muted pointer-coarse:h-10 pointer-coarse:pr-2 pointer-coarse:pl-3">
			{label}
			<ChevronRightIcon className="size-4 text-muted-foreground" />
		</span>
	);
}

/**
 * Tells `sight` whether `line`, card `id`'s line in the thread, shows at
 * least `IN_VIEW` of itself, and that it no longer does once it goes.
 */
function useLineInSight(
	line: HTMLElement | null,
	id: string,
	sight: Sheets["sight"] | undefined,
): void {
	useEffect(() => {
		if (line === null || sight === undefined) {
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				const latest = entries.at(-1);
				if (latest !== undefined) {
					sight(id, latest.intersectionRatio >= IN_VIEW);
				}
			},
			{ threshold: IN_VIEW },
		);
		observer.observe(line);
		return () => {
			observer.disconnect();
			sight(id, false);
		};
	}, [line, id, sight]);
}

/** A line naming a waiting card, opening its sheet on a tap. */
function SheetLine({
	ref,
	title,
	Icon,
	tone,
	action,
	onOpen,
}: {
	ref: Ref<HTMLButtonElement>;
	title: string;
	Icon: LucideIcon;
	tone: Tone;
	action: string;
	onOpen: () => void;
}): JSX.Element {
	return (
		<button
			ref={ref}
			type="button"
			onClick={onOpen}
			className={cn(
				"group flex w-full items-center gap-3 rounded-xl border bg-card pl-4 text-left shadow-xs",
				lineCard,
				CARD_SPACE,
			)}
		>
			<Icon className={cn("size-5 shrink-0", TONES[tone].icon)} />
			<span className="min-w-0 flex-1 truncate font-medium">{title}</span>
			<Action label={action} />
		</button>
	);
}
