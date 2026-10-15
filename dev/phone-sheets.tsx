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
import { useCardReply } from "./card-reply";
import { TONES, type Tone } from "./card-shell";
import { useArrived } from "./task-view";

/** A card an agent waits on you through, opened in a sheet of its own. */
interface Sheet {
	id: string;
	title: string;
	Icon: LucideIcon;
	tone: Tone;
	open: () => void;
}

/**
 * The cards in a phone's thread that wait on you, newest last: what the bar
 * above the composer opens. None beside a sidebar, where they show in full.
 */
interface Sheets {
	add(sheet: Sheet): () => void;
	shown: Sheet[];
}

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
	// An arrival before any card came up, as while the thread loads: the
	// first to come up opens.
	const arriving = useRef(false);
	const [shown, setShown] = useState<Sheet[]>([]);
	const add = useCallback((sheet: Sheet) => {
		all.current = [
			...all.current.filter((each) => each.id !== sheet.id),
			sheet,
		];
		setShown(all.current);
		if (arriving.current) {
			arriving.current = false;
			sheet.open();
		}
		return () => {
			all.current = all.current.filter((each) => each.id !== sheet.id);
			setShown(all.current);
		};
	}, []);
	const sheets = useMemo(() => ({ add, shown }), [add, shown]);
	// Beside a sidebar, the thread scrolls to it instead.
	useArrived(on ? conversation : "", () => {
		const latest = all.current.at(-1);
		if (latest === undefined) {
			arriving.current = true;
		} else {
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
 * screen, which that line or the bar above the composer opens. Anywhere else,
 * or once answered, the card as it is.
 */
export function Sheeted({
	title,
	Icon,
	tone,
	children,
}: {
	title: string;
	Icon: LucideIcon;
	tone: Tone;
	children: ReactNode;
}): ReactNode {
	const sheets = useContext(SheetsContext);
	const { reply, sent } = useCardReply();
	const live = sent === null && reply?.send != null;
	const [open, setOpen] = useState(false);
	const id = useId();
	// Pinned above the keyboard, so "Anything else" stays in sight as it is typed.
	const { top, height, keyboard } = useViewport();
	const [body, setBody] = useState<HTMLDivElement | null>(null);
	useTypedInView(body, height);
	const add = sheets?.add;
	useEffect(() => {
		if (add !== undefined && live) {
			return add({ id, title, Icon, tone, open: () => setOpen(true) });
		}
	}, [add, live, id, title, Icon, tone]);
	if (sheets === null || !live) {
		return children;
	}
	return (
		<>
			<SheetLine
				title={title}
				Icon={Icon}
				tone={tone}
				onOpen={() => setOpen(true)}
			/>
			<DialogPrimitive.Root open={open} onOpenChange={setOpen}>
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
							{/* Closing does the same, but says nothing of where it goes. */}
							<DialogPrimitive.Close className="flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 font-medium text-muted-foreground text-sm outline-none focus-visible:bg-muted active:bg-muted [&_svg]:size-4">
								<MessageSquareIcon />
								Conversation
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
function useTypedInView(sheet: HTMLElement | null, _height: number): void {
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
	}, [sheet]);
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
 * tap from its sheet: so what needs you is never a scroll away.
 */
export function NeedsYouBar(): ReactNode {
	const latest = useContext(SheetsContext)?.shown.at(-1);
	if (latest === undefined) {
		return null;
	}
	// As quiet as the Archive bar beside it, the tone in its icon alone, so it
	// never outshouts the composer; the whole bar is the tap.
	const { title, Icon, tone, open } = latest;
	return (
		<button
			type="button"
			onClick={open}
			className="group flex w-full items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-left text-sm shadow-xs"
		>
			<Icon className={cn("size-4 shrink-0", TONES[tone].icon)} />
			<span className="min-w-0 flex-1 truncate">{title}</span>
			<span className="flex h-7 shrink-0 items-center gap-0.5 rounded-md border bg-background pr-1.5 pl-2.5 font-medium shadow-xs group-active:bg-muted">
				Answer
				<ChevronRightIcon className="size-4 text-muted-foreground" />
			</span>
		</button>
	);
}

/** A line naming a waiting card, opening its sheet on a tap. */
function SheetLine({
	title,
	Icon,
	tone,
	onOpen,
}: {
	title: string;
	Icon: LucideIcon;
	tone: Tone;
	onOpen: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onOpen}
			className="flex min-h-12 w-full items-center gap-3 rounded-xl border bg-card px-4 text-left shadow-xs active:bg-muted"
		>
			<Icon className={cn("size-5 shrink-0", TONES[tone].icon)} />
			<span className="min-w-0 flex-1 truncate font-medium">{title}</span>
			<span className="flex shrink-0 items-center gap-0.5 text-muted-foreground text-sm">
				Open
				<ChevronRightIcon className="size-4" />
			</span>
		</button>
	);
}
