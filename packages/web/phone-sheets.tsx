import { useAuiState } from "@assistant-ui/react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { type LucideIcon, XIcon } from "lucide-react";
import {
	createContext,
	type JSX,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { raises } from "#web/hooks/use-touch.ts";
import { useViewport } from "#web/hooks/use-viewport.ts";
import { cn } from "#web/lib/utils.ts";
import { useArrived } from "./arrivals";
import { InMessageContext, useCardReply } from "./card-reply";
import { CARD_SPACE, TONES, type Tone } from "./card-shell";
import { ThreadBar } from "./thread-bar";

/** A card an agent waits on you through, opened in a sheet of its own. */
interface Sheet {
	id: string;
	title: string;
	Icon: LucideIcon;
	tone: Tone;
	/** What its line and the bar call a tap on it. */
	action: string;
	/**
	 * Whether an arrival opens it. Not when its message has words beside it,
	 * which are read in the thread first.
	 */
	bare: boolean;
	/** Opens the sheet over the thread. */
	open: () => void;
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

/** True while rendering inside a mobile `Sheeted` popup. */
export const InSheetContext = createContext(false);

/** Whether the current tree is rendered inside a mobile card sheet. */
export function useInSheet(): boolean {
	return useContext(InSheetContext);
}

/**
 * Holds the waiting cards of the thread in `children` in sheets, and opens
 * the newest once ⌥⌘M or the inbox opens this conversation for it.
 */
export function PhoneSheets({
	conversation,
	on,
	whole,
	children,
}: {
	/** The conversation's id, which an arrival names. */
	conversation: string;
	/** Whether to: on a phone; beside a sidebar, cards show in full. */
	on: boolean;
	/**
	 * Whether the thread has all its messages. A listing's summary lacks the
	 * tool calls and thoughts, so reading it whole moves the cards among the
	 * parts and mounts them anew, closing a sheet opened before.
	 */
	whole: boolean;
	children: ReactNode;
}): JSX.Element {
	const all = useRef<Sheet[]>([]);
	// An arrival before any card came up, or before the thread was whole, as
	// while it loads: the first to come up opens.
	const arriving = useRef(false);
	const complete = useRef(whole);
	complete.current = whole;
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
		if (arriving.current && complete.current) {
			if (sheet.bare) {
				sheet.open();
			}
			arriving.current = false;
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
	useArrived(on ? conversation : "", () => {
		const latest = all.current.at(-1);
		if (latest === undefined || !complete.current) {
			arriving.current = true;
		} else if (latest.bare) {
			latest.open();
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
	subtitle,
	Icon,
	tone,
	action = "Answer",
	always = false,
	waiting = true,
	children,
}: {
	title: string;
	/** Quiet second line below the title inside the sheet header. */
	subtitle?: ReactNode;
	Icon: LucideIcon;
	tone: Tone;
	/** What a tap on its line or the bar does, "Answer" unless it asks nothing. */
	action?: string;
	/** Open in a sheet on mobile even when the card is not waiting on a reply. */
	always?: boolean;
	/** Whether this card is waiting on user action (registers with `NeedsYouBar` and arrivals). */
	waiting?: boolean;
	children: ReactNode;
}): ReactNode {
	const sheets = useContext(SheetsContext);
	const { reply, sent } = useCardReply();
	const live = waiting && sent === null && reply?.send != null;
	const hasSubtitle =
		subtitle !== undefined && subtitle !== null && subtitle !== false;
	const [open, setOpen] = useState(false);
	const show = useCallback(() => {
		setOpen(true);
	}, []);
	const id = useId();
	// Pinned above the keyboard, so "Anything else" stays in sight as it is typed.
	const { top, height, keyboard } = useViewport();
	const [body, setBody] = useState<HTMLDivElement | null>(null);
	useTypedInView(body, height);
	const [line, setLine] = useState<HTMLElement | null>(null);
	useLineInSight(line, id, live ? sheets?.sight : undefined);
	if (sheets === null || (!live && !always)) {
		return children;
	}
	return (
		<>
			{live && (
				<RegisterSheet
					add={sheets.add}
					id={id}
					title={title}
					Icon={Icon}
					tone={tone}
					action={action}
					open={show}
				/>
			)}
			<ThreadBar
				ref={setLine}
				Icon={Icon}
				iconTone={tone}
				label={title}
				cta={action}
				onPress={() => show()}
				className={CARD_SPACE}
			/>
			<DialogPrimitive.Root open={open} onOpenChange={setOpen}>
				<DialogPrimitive.Portal>
					<DialogPrimitive.Popup
						style={{ top, height }}
						className="fixed inset-x-0 z-50 flex flex-col bg-background outline-none transition-transform duration-200 ease-out data-ending-style:translate-y-full data-starting-style:translate-y-full"
					>
						<header
							className={cn(
								"box-content flex h-(--top-bar-height) shrink-0 items-center gap-2 border-b pt-[env(safe-area-inset-top)] pr-2 pl-4",
								TONES[tone].header,
							)}
						>
							<Icon
								aria-hidden
								className={cn("size-4 shrink-0", TONES[tone].icon)}
							/>
							<div className="flex min-w-0 flex-1 flex-col">
								<DialogPrimitive.Title className="min-w-0 truncate font-medium text-sm">
									{title}
								</DialogPrimitive.Title>
								{hasSubtitle && (
									<div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-muted-foreground text-[11px] leading-4 [&>*]:min-w-0 [&>*]:truncate [&>span]:text-[11px] [&>span]:leading-4 [&>span_span]:text-[11px] [&>span_span]:leading-4 [&_button]:shrink-0">
										{subtitle}
									</div>
								)}
							</div>
							<DialogPrimitive.Close
								aria-label="Close"
								className="flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:bg-muted active:bg-muted [&_svg]:size-5"
							>
								<XIcon />
							</DialogPrimitive.Close>
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
							<InSheetContext value={true}>{children}</InSheetContext>
						</div>
					</DialogPrimitive.Popup>
				</DialogPrimitive.Portal>
			</DialogPrimitive.Root>
		</>
	);
}

/** Registers a live waiting card with `PhoneSheets` so arrivals and `NeedsYouBar` can open it. */
function RegisterSheet(props: {
	add: Sheets["add"];
	id: string;
	title: string;
	Icon: LucideIcon;
	tone: Tone;
	action: string;
	open: () => void;
}): JSX.Element {
	const inMessage = useContext(InMessageContext);
	return inMessage ? (
		<RegisterMessageSheet {...props} />
	) : (
		<RegisterStandaloneSheet {...props} bare />
	);
}

function RegisterMessageSheet(props: {
	add: Sheets["add"];
	id: string;
	title: string;
	Icon: LucideIcon;
	tone: Tone;
	action: string;
	open: () => void;
}): JSX.Element {
	// Whether the message holds no words beside the card.
	const bare = useAuiState((state) =>
		state.message.content.every(
			(part) => part.type !== "text" || part.text.trim() === "",
		),
	);
	return <RegisterStandaloneSheet {...props} bare={bare} />;
}

function RegisterStandaloneSheet({
	add,
	id,
	title,
	Icon,
	tone,
	action,
	bare,
	open,
}: {
	add: Sheets["add"];
	id: string;
	title: string;
	Icon: LucideIcon;
	tone: Tone;
	action: string;
	bare: boolean;
	open: () => void;
}): null {
	useEffect(() => {
		return add({ id, title, Icon, tone, action, bare, open });
	}, [add, id, title, Icon, tone, action, bare, open]);
	return null;
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
		// Its growth, not its input: a box's editor lays out the line it breaks
		// itself, with no input event, as it does a take's words.
		const grown = new ResizeObserver(later);
		const focused = () => {
			grown.disconnect();
			const field = document.activeElement;
			if (field instanceof HTMLElement && sheet.contains(field)) {
				grown.observe(field);
			}
			later();
		};
		focused();
		sheet.addEventListener("focusin", focused);
		sheet.addEventListener("input", later);
		return () => {
			cancelAnimationFrame(frame);
			grown.disconnect();
			sheet.removeEventListener("focusin", focused);
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
			<ThreadBar
				Icon={Icon}
				iconTone={tone}
				label={title}
				cta={action}
				onPress={() => open()}
			/>
		</aside>
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
