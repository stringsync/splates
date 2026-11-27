import type { Stuck } from "@splates/server/server";
import { EllipsisVerticalIcon } from "lucide-react";
import { createContext, type JSX, type ReactNode, useContext } from "react";
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
} from "#web/components/ui/dropdown-menu.tsx";
import { cn } from "#web/lib/utils.ts";
import { useWide } from "./app-nav";
import { useFit } from "./bar-fit";
import { RefreshStatus } from "./freshness";
import { pageArea } from "./page-areas";
import { DesktopPageHeaderBand, PhonePageHeaderBand } from "./page-header-band";
import type { Page } from "./page-route";
import { ProjectSwitcher } from "./projects";
import { RestartButton } from "./restart-button";

export const TopBarFrame = createContext<BarFrame | null>(null);

/** Render a page title or breadcrumb with actions. Pass leading for a navigation control, detail for supporting text, and actions for the responsive action menu. */
export function TopBar({
	leading,
	title,
	detail,
	description,
	badge,
	tabs,
	actions = [],
	project: named = false,
	className,
}: {
	leading?: ReactNode;
	/** Words, which it truncates, or a heading of the page's own. */
	title: ReactNode;
	/** After the title, smaller, as the branch a conversation runs on. */
	detail?: ReactNode;
	/** Replaces the page area's default description; pass null to omit it. */
	description?: ReactNode;
	/** Optional opaque pill shown beside the title (defaults to the area's scope pill on full headers). */
	badge?: ReactNode;
	/** Sub-page tabs docked flush onto the header's neutral bottom hairline. */
	tabs?: ReactNode;
	actions?: BarAction[];
	/** Whether a phone names the project under the title: a conversation's bar. */
	project?: boolean;
	/** For a bar in place: sticky, bordered, clear of a phone's notch. */
	className?: string;
}): ReactNode {
	const frame = useContext(TopBarFrame);
	const wide = useWide();
	const menu = frame?.menu ?? null;
	const kept = actions.filter((action) => action.kebab === true);
	const shown = actions.filter((action) => action.kebab !== true);
	const { room, titled, detailed, stated, restart, measure, fit } = useFit(
		shown.length,
		menu !== null || kept.length > 0,
	);
	const folded = [...shown.slice(fit), ...kept];
	const area = frame?.area ? pageArea(frame.area.page) : null;
	const styled = area !== null && title !== "";
	const resolvedDescription =
		description !== undefined ? description : (area?.description ?? null);
	const resolvedBadge =
		badge !== undefined
			? badge
			: area !== null && !area.compact && area.scope !== null
				? area.scope === "everywhere"
					? "All projects"
					: frame?.project
						? `Project · ${frame.project}`
						: "Project"
				: null;
	// The project's line under the title, with the detail on it.
	const project = named && !wide ? frame?.project : undefined;
	const pageTitle =
		typeof title === "string" ? (
			<h2 title={title} className={cn(TITLE, "truncate")}>
				{title}
			</h2>
		) : (
			title
		);
	const heading = frame?.untitled === true ? null : pageTitle;
	const below = project !== undefined;
	const controls = (
		<>
			<div
				ref={restart}
				className="flex w-20 shrink-0 items-center justify-end max-md:empty:hidden md:w-24"
			>
				{frame?.dot !== undefined ? (
					<RestartButton
						wide={wide}
						update={frame.dot}
						stuck={frame.stuck ?? null}
						onInvestigateStuck={frame.onInvestigateStuck}
					/>
				) : (
					<RefreshStatus updating={frame?.refreshing} />
				)}
			</div>
			{(folded.length > 0 || menu !== null) && (
				<Kebab actions={folded} menu={menu} wide={wide} />
			)}
			{shown.slice(0, fit).map((action) => (
				<ActionButton key={action.label} action={action} wide={wide} />
			))}
			{/* Every action and the kebab, unseen, to tell how wide each is. */}
			<div
				ref={measure}
				aria-hidden
				inert
				className="pointer-events-none invisible absolute top-0 left-0 flex gap-1"
			>
				{shown.map((action) => (
					<span key={action.label} className={buttonClass(action, wide)}>
						<Face action={action} />
					</span>
				))}
				<span className={buttonClass(null, wide)}>
					<EllipsisVerticalIcon />
				</span>
			</div>
		</>
	);
	const row = (
		<>
			{leading && frame?.badge ? (
				<span className="relative flex shrink-0">
					{leading}
					{frame.badge}
				</span>
			) : (
				leading
			)}
			<div ref={room} className="flex min-w-0 flex-1 items-center gap-1">
				<div className="flex min-w-0 flex-1 items-center gap-2">
					<div ref={titled} className="flex min-w-0 items-center gap-1.5">
						{below ? (
							<div className="flex min-w-0 flex-col">
								{heading}
								<div className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
									<ProjectSwitcher
										name={project}
										bar
										servers={false}
										className="-my-0.5 shrink-0 py-0.5"
									/>
									{detail}
								</div>
							</div>
						) : (
							heading
						)}
					</div>
					{/* Whole up to a long branch, so its icons never spill over
					    the actions: the title gives way instead. */}
					{Boolean(detail) && !below && (
						<div
							ref={detailed}
							className="flex min-w-0 max-w-60 shrink-0 items-center text-muted-foreground"
						>
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
				{controls}
			</div>
		</>
	);

	const desktopBand =
		styled && area !== null && frame?.untitled !== true ? (
			<DesktopPageHeaderBand
				area={area}
				title={title}
				badge={resolvedBadge}
				description={resolvedDescription}
				detail={detail}
				status={frame?.status}
				tabs={tabs}
				controls={controls}
				sidebarHidden={frame?.area?.sidebarHidden}
				roomRef={room}
				titledRef={titled}
				detailedRef={detailed}
				statedRef={stated}
			/>
		) : null;

	const phoneBand =
		styled && area !== null && frame?.untitled === true ? (
			<PhonePageHeaderBand
				area={area}
				title={title}
				badge={resolvedBadge}
				description={resolvedDescription}
				tabs={tabs}
			/>
		) : null;

	if (frame?.slot !== undefined) {
		// Nothing until the shell's row is there to take it.
		if (frame.slot === null) {
			return null;
		}
		return (
			<>
				{createPortal(desktopBand ?? row, frame.slot)}
				{frame.titleSlot &&
					createPortal(phoneBand ?? pageTitle, frame.titleSlot)}
				{frame.bannerSlot != null &&
					frame.banner !== undefined &&
					createPortal(frame.banner, frame.bannerSlot)}
			</>
		);
	}
	return (
		<>
			<header
				className={cn(
					"relative flex h-(--top-bar-height) shrink-0 items-center gap-1",
					wide ? "px-2" : "px-1",
					className,
				)}
			>
				{row}
			</header>
			{tabs}
			{frame?.banner}
		</>
	);
}

/** Area identity handed to `TopBar` by the desktop and phone shells. */
export interface PageAreaFrame {
	/** The active page, for its color, icon, description, and layout width. */
	page: Page;
	/** Desktop only: adds left clearance for the fixed `SidebarHead` while the sidebar is hidden. */
	sidebarHidden?: boolean;
}

/** What the page's shell gives every bar under it. */
export interface BarFrame {
	/**
	 * The shell's row, where the bar goes, null until it is there, or left
	 * out to draw the bar in place.
	 */
	slot?: HTMLElement | null;
	/** A phone shows its page header below the project bar. */
	titleSlot?: HTMLElement | null;
	/** Said after every title: outdated or a restart under way. */
	status?: ReactNode;
	/** The server is updating, even before its streams drop. */
	refreshing?: boolean;
	/** A full-width message under the bar. */
	banner?: ReactNode;
	/** Where the banner goes when the bar itself goes in `slot`. */
	bannerSlot?: HTMLElement | null;
	/** The page menu's items, at the foot of the kebab. */
	menu?: ReactNode;
	/** Puts Update before the kebab, once a restart would update splates. */
	dot?: boolean;
	/** Puts Stuck before the kebab when the server's source checkout fell behind upstream. */
	stuck?: Stuck | null;
	/** Sends a stuck server checkout to an agent to investigate. */
	onInvestigateStuck?: (stuck: Stuck) => Promise<void>;
	/** Marks a bar's way back, as with how many agents wait on you. */
	badge?: ReactNode;
	/**
	 * The project's name, which a phone's bar of the project's own, as a
	 * conversation's, puts under its title as a switcher, and full page headers
	 * show in their scope pill.
	 */
	project?: string;
	/**
	 * Leaves the title out of `slot`, as a phone's project bar does, putting
	 * the page header in `titleSlot` underneath.
	 */
	untitled?: boolean;
	/** Active page area for the integrated atmospheric header band. */
	area?: PageAreaFrame;
}

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
	/** Kept in the kebab whatever the room, as a phone's New conversation. */
	kebab?: boolean;
}

/** How a heading over a group of a nav's pages reads. */
export const NAV_HEADING =
	"truncate px-3 font-medium text-muted-foreground text-xs uppercase tracking-wide";

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
					className="absolute top-1 right-1 size-1.5 rounded-full bg-success"
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
	wide,
}: {
	actions: BarAction[];
	menu: ReactNode;
	wide: boolean;
}): JSX.Element {
	const busy = actions.some(
		(action) => action.busy === true && action.expanded !== true,
	);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label="More"
				title="More"
				className={buttonClass(null, wide)}
			>
				<EllipsisVerticalIcon />
				{busy && (
					<span
						aria-hidden
						className="absolute top-1 right-1 size-1.5 rounded-full bg-success"
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
export const BELOW_BAR =
	"h-[calc(100dvh-var(--page-header-height,var(--top-bar-height))-1rem)]";
