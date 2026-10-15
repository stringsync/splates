import { EllipsisVerticalIcon } from "lucide-react";
import {
	createContext,
	type JSX,
	type ReactNode,
	useContext,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "#dev/components/ui/dropdown-menu.tsx";
import { cn } from "#dev/lib/utils.ts";
import { useWide } from "./app-nav";
import { UpdateDot } from "./release";

/**
 * Something a page can do from its bar: an icon, with words beside it only
 * when they say what it is set to, as a period's "7 days".
 */
export interface BarAction {
	/** What it does: its tooltip, its name to a screen reader, its row in the kebab. */
	label: string;
	icon: ReactNode;
	/** Words beside the icon in the bar; none for the icon alone. */
	text?: string;
	/** What a click does; none when it opens `menu`. */
	run?: () => void;
	/** The items it opens, a submenu of the kebab once folded into it. */
	menu?: ReactNode;
	menuClassName?: string;
	/** Whether what it shows or hides is showing, as the widgets. */
	expanded?: boolean;
	/** Marks it while something it holds is going, as a command running. */
	busy?: boolean;
	/** Its shortcut, as `⌥⌘/`, in its tooltip and its row in the kebab. */
	shortcut?: string | null;
}

/** What the page's shell gives every bar under it. */
export interface BarFrame {
	/**
	 * The shell's row, where the bar goes, null until it is there, or left
	 * out to draw the bar in place.
	 */
	slot?: HTMLElement | null;
	/** Said after every title: offline, outdated, a restart under way. */
	status?: ReactNode;
	/** The page menu's items, at the foot of the kebab. */
	menu?: ReactNode;
	/** Dots the kebab, as when a restart would update arbor. */
	dot?: boolean;
	/** Ends the bar, never folded, as how many agents wait on you. */
	end?: ReactNode;
}

export const TopBarFrame = createContext<BarFrame | null>(null);

/**
 * The bar atop every page and conversation, one line of text and icons at
 * `--top-bar-height`: what leads it, as a way back, then the title, the
 * page's status and what `detail` adds, then its actions. Those that do not
 * fit fold into a kebab on their left, the last first, so the first stay in
 * sight; the kebab holds the page menu too, where the shell gives one. Under
 * a shell that keeps a row for it, it goes there, so the bar stays put
 * however the page under it scrolls or is laid out.
 */
export function TopBar({
	leading,
	title,
	detail,
	actions = [],
	className,
}: {
	leading?: ReactNode;
	/** Words, which it truncates, or a heading of the page's own. */
	title: ReactNode;
	/** After the title, smaller, as the branch a conversation runs on. */
	detail?: ReactNode;
	actions?: BarAction[];
	/** For a bar in place: sticky, bordered, clear of a phone's notch. */
	className?: string;
}): ReactNode {
	const frame = useContext(TopBarFrame);
	const wide = useWide();
	const menu = frame?.menu ?? null;
	const { room, titled, stated, measure, fit } = useFit(
		actions.length,
		menu !== null,
	);
	const folded = actions.slice(fit);
	const row = (
		<>
			{leading}
			<div ref={room} className="flex min-w-0 flex-1 items-center gap-1">
				<div className="flex min-w-0 flex-1 items-center gap-2">
					<div ref={titled} className="flex min-w-0 items-center">
						{typeof title === "string" ? (
							<h2 title={title} className={cn(TITLE, "truncate")}>
								{title}
							</h2>
						) : (
							title
						)}
					</div>
					{Boolean(detail) && (
						<div className="flex min-w-0 shrink-[2] items-center text-muted-foreground">
							{detail}
						</div>
					)}
					<div
						ref={stated}
						className="flex shrink-0 items-center gap-2 empty:hidden"
					>
						{frame?.status}
					</div>
				</div>
				{(folded.length > 0 || menu !== null) && (
					<Kebab
						actions={folded}
						menu={menu}
						dot={frame?.dot === true}
						wide={wide}
					/>
				)}
				{actions.slice(0, fit).map((action) => (
					<ActionButton key={action.label} action={action} wide={wide} />
				))}
				{/* Every action and the kebab, unseen, to tell how wide each is. */}
				<div
					ref={measure}
					aria-hidden
					inert
					className="pointer-events-none invisible absolute top-0 left-0 flex gap-1"
				>
					{actions.map((action) => (
						<span key={action.label} className={buttonClass(action, wide)}>
							<Face action={action} />
						</span>
					))}
					<span className={buttonClass(null, wide)}>
						<EllipsisVerticalIcon />
					</span>
				</div>
			</div>
			{frame?.end}
		</>
	);
	if (frame?.slot !== undefined) {
		// Nothing until the shell's row is there to take it.
		return frame.slot === null ? null : createPortal(row, frame.slot);
	}
	return (
		<header
			className={cn(
				"relative flex h-(--top-bar-height) shrink-0 items-center gap-1",
				wide ? "px-2" : "px-1",
				className,
			)}
		>
			{row}
		</header>
	);
}

/** How a bar's title reads, for a page that heads it with its own. */
export const TITLE =
	"min-w-0 font-medium text-sm max-md:font-semibold max-md:text-base";

/**
 * A button in a bar, the size of every other: a fingertip on a phone, as a
 * way back or to the drawer, and a click's beside a sidebar.
 */
export function BarButton({
	label,
	onClick,
	disabled = false,
	children,
}: {
	label: string;
	onClick: () => void;
	/** Kept in its place while there is nothing to do, so nothing shifts. */
	disabled?: boolean;
	children: ReactNode;
}): JSX.Element {
	const wide = useWide();
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={onClick}
			disabled={disabled}
			className={buttonClass(null, wide)}
		>
			{children}
		</button>
	);
}

/** Room a title keeps before actions fold away for it, in pixels. */
const TITLE_ROOM = 128;
/** The gap between a bar's items, `gap-1`. */
const GAP = 4;

/**
 * How many of `count` actions fit beside the title and the status, measured
 * from an unseen copy of them each time the bar, its title, its status or
 * its actions change size: all when they do, or as many as leave room for
 * the kebab, the status, and `TITLE_ROOM` of the title, or the whole title
 * when shorter.
 */
function useFit(
	count: number,
	menu: boolean,
): {
	room: React.RefObject<HTMLDivElement | null>;
	titled: React.RefObject<HTMLDivElement | null>;
	stated: React.RefObject<HTMLDivElement | null>;
	measure: React.RefObject<HTMLDivElement | null>;
	fit: number;
} {
	const room = useRef<HTMLDivElement>(null);
	const titled = useRef<HTMLDivElement>(null);
	const stated = useRef<HTMLDivElement>(null);
	const measure = useRef<HTMLDivElement>(null);
	const [fit, setFit] = useState(count);
	const fitRef = useRef<() => void>(() => {});
	fitRef.current = () => {
		const into = room.current;
		const copies = measure.current;
		if (into === null || copies === null) {
			return;
		}
		// Not laid out, as before the page shows: nothing to fold for.
		if (into.clientWidth === 0) {
			setFit(count);
			return;
		}
		const widths = [...copies.children].map(
			(each) => (each as HTMLElement).offsetWidth,
		);
		const kebab = (widths.pop() ?? 0) + GAP;
		// What the title would take untruncated: its heading's whole width.
		const heading = titled.current?.firstElementChild;
		const title = Math.min(heading?.scrollWidth ?? 0, TITLE_ROOM);
		// The status keeps its whole width; the detail gives way first.
		const status = stated.current?.offsetWidth ?? 0;
		const space = into.clientWidth - title - (status > 0 ? status + 8 : 0);
		const across = (first: number) =>
			widths.slice(0, first).reduce((sum, width) => sum + width + GAP, 0);
		let shown = count;
		while (
			shown > 0 &&
			across(shown) + (menu || shown < count ? kebab : 0) > space
		) {
			shown -= 1;
		}
		setFit(shown);
	};
	useLayoutEffect(() => fitRef.current());
	useLayoutEffect(() => {
		const resized = new ResizeObserver(() => fitRef.current());
		for (const each of [
			room.current,
			titled.current,
			stated.current,
			measure.current,
		]) {
			if (each !== null) {
				resized.observe(each);
			}
		}
		return () => resized.disconnect();
	}, []);
	return { room, titled, stated, measure, fit: Math.min(fit, count) };
}

function buttonClass(action: BarAction | null, wide: boolean): string {
	const worded = action?.text !== undefined;
	return cn(
		"relative flex shrink-0 items-center justify-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
		wide
			? "h-8 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:text-foreground [&_svg]:size-4"
			: "h-11 rounded-full text-foreground active:bg-muted [&_svg]:size-5",
		worded ? (wide ? "px-2 text-sm" : "px-3 text-base") : wide ? "w-8" : "w-11",
	);
}

/** What an action shows in the bar: its icon, its words, and its busy dot. */
function Face({ action }: { action: BarAction }): JSX.Element {
	return (
		<>
			{action.icon}
			{action.text !== undefined && (
				<span className="whitespace-nowrap">{action.text}</span>
			)}
			{action.busy === true && action.expanded !== true && (
				<span
					aria-hidden
					className="absolute top-1 right-1 size-1.5 animate-pulse rounded-full bg-success"
				/>
			)}
		</>
	);
}

function ActionButton({
	action,
	wide,
}: {
	action: BarAction;
	wide: boolean;
}): JSX.Element {
	const tip =
		action.shortcut == null
			? action.label
			: `${action.label} (${action.shortcut})`;
	const shared = {
		type: "button",
		// What it is set to, too, as "Period: 7 days".
		"aria-label":
			action.text === undefined
				? action.label
				: `${action.label}: ${action.text}`,
		title: tip,
		className: buttonClass(action, wide),
		"data-bar-action": true,
	} as const;
	if (action.menu === undefined) {
		return (
			<button {...shared} aria-expanded={action.expanded} onClick={action.run}>
				<Face action={action} />
			</button>
		);
	}
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<button {...shared} />}>
				<Face action={action} />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className={action.menuClassName}>
				{action.menu}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * The actions that did not fit, the first of them first, each with its own
 * menu as a submenu, then the page menu's items.
 */
function Kebab({
	actions,
	menu,
	dot,
	wide,
}: {
	actions: BarAction[];
	menu: ReactNode;
	dot: boolean;
	wide: boolean;
}): JSX.Element {
	const busy = actions.some(
		(action) => action.busy === true && action.expanded !== true,
	);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label={dot ? "More: restart to update" : "More"}
				title="More"
				className={buttonClass(null, wide)}
			>
				<span className="relative flex">
					<EllipsisVerticalIcon />
					{dot && <UpdateDot />}
				</span>
				{busy && (
					<span
						aria-hidden
						className="absolute top-1 right-1 size-1.5 animate-pulse rounded-full bg-success"
					/>
				)}
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				className={cn("w-56", !wide && "[&_[role^=menuitem]]:h-11")}
			>
				{actions.map((action) =>
					action.menu === undefined ? (
						<DropdownMenuItem key={action.label} onClick={action.run}>
							{action.icon}
							{action.label}
							{action.shortcut != null && (
								<DropdownMenuShortcut aria-hidden>
									{action.shortcut}
								</DropdownMenuShortcut>
							)}
						</DropdownMenuItem>
					) : (
						<DropdownMenuSub key={action.label}>
							<DropdownMenuSubTrigger>
								{action.icon}
								<span className="flex-1">{action.label}</span>
								{action.text !== undefined && (
									<span className="text-muted-foreground text-xs">
										{action.text}
									</span>
								)}
							</DropdownMenuSubTrigger>
							<DropdownMenuSubContent className={action.menuClassName}>
								{action.menu}
							</DropdownMenuSubContent>
						</DropdownMenuSub>
					),
				)}
				{actions.length > 0 && menu !== null && <DropdownMenuSeparator />}
				{menu}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * How tall a conversation's page is beside a sidebar: the screen, less the
 * bar above it and the padding below.
 */
export const BELOW_BAR = "h-[calc(100dvh-var(--top-bar-height)-1rem)]";
