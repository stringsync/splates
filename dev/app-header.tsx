import { type JSX, useEffect, useRef } from "react";
import { cn } from "#dev/lib/utils.ts";
import type { Snapshot } from "../snapshot";
import { CheckpointRefusal, PowerBadge, useCheckpoint } from "./checkpoint";
import { MachineBadge, useMachine } from "./machine";
import { PageMenu } from "./page-menu";
import { ProjectSwitcher } from "./projects";

/**
 * Heads the sidebar when there is one, and the page on a phone: the project
 * switcher, a badge when the server is outdated, unbuilt or offline, or the
 * machine is strained, the page menu, the project's path beside a sidebar,
 * or in its place how a restart goes, and why a checkpoint could not start.
 * A phone keeps to the one line, as every bar atop it does.
 */
export function AppHeader({
	name,
	snapshot,
	outdated,
	offline,
	wide,
	onSettings,
}: {
	name: string;
	snapshot: Snapshot | null;
	/** Why a newer arbor has the server refusing, or null. */
	outdated: string | null;
	offline: boolean;
	wide: boolean;
	onSettings: () => void;
}): JSX.Element {
	// Whether Power says a restart would update arbor, with a dot.
	const hinted =
		(snapshot?.release != null || snapshot?.behind != null) &&
		outdated === null &&
		!offline;
	// Asked once here for the badge and the menu alike.
	const machine = useMachine();
	const { badge } = useCheckpoint();
	const ref = useRef<HTMLElement>(null);
	// Fixed over the sidebar, it tells the tabs how far down to start, so a
	// line it grows, such as Power's badge, pushes them down rather than
	// landing on them.
	useEffect(() => {
		const header = ref.current;
		if (!wide || header === null) {
			return;
		}
		const root = document.documentElement.style;
		const measure = () =>
			root.setProperty("--app-header-height", `${header.offsetHeight}px`);
		measure();
		const resized = new ResizeObserver(measure);
		resized.observe(header);
		return () => {
			resized.disconnect();
			root.removeProperty("--app-header-height");
		};
	}, [wide]);
	return (
		<header
			ref={ref}
			className={cn(
				"flex min-w-0 flex-col gap-0.5",
				wide
					? "fixed top-0 left-0 z-50 w-(--sidebar-width) px-6 pt-5"
					: "border-b px-4 py-2.5",
			)}
		>
			<div className="flex min-w-0 items-center gap-2">
				{/* Which `arbor dev --slot` this is, when several are open. */}
				{snapshot?.slot != null && (
					<span
						role="img"
						aria-label={`slot ${snapshot.slot.word}`}
						title={`Served by the ${snapshot.slot.word} slot of arbor dev`}
						className="shrink-0 text-base leading-none"
					>
						{snapshot.slot.emoji}
					</span>
				)}
				<ProjectSwitcher name={name} />
				{/* Silent while connected, which is the normal case. Once the
									    server stops answering, the page says so, since what it
									    shows may no longer be true. */}
				{/* Up but refusing: a newer arbor moved the records on. */}
				{outdated !== null && !offline && (
					<span
						role="status"
						title={outdated}
						className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-medium text-[11px] text-amber-600 leading-none dark:text-amber-400"
					>
						<span className="size-1.5 rounded-full bg-amber-500" />
						Outdated
					</span>
				)}
				{/* Up, but serving the page built before, since building this
									    one failed, as when a merge added a package. */}
				{snapshot?.unbuilt === true && outdated === null && !offline && (
					<span
						role="status"
						title="Building this page failed as arbor dev started, so it may be out of date: the terminal running arbor dev says why"
						className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-medium text-[11px] text-amber-600 leading-none dark:text-amber-400"
					>
						<span className="size-1.5 rounded-full bg-amber-500" />
						Build failed
					</span>
				)}
				{offline && (
					<span
						role="status"
						title="arbor dev stopped answering: is it still running?"
						className="flex shrink-0 items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 font-medium text-[11px] text-destructive leading-none"
					>
						<span className="size-1.5 rounded-full bg-destructive" />
						Offline
					</span>
				)}
				{!offline && <MachineBadge reading={machine} />}
				<PageMenu
					machine={offline ? null : machine}
					release={hinted ? (snapshot?.release ?? null) : null}
					behind={hinted ? (snapshot?.behind ?? null) : null}
					onSettings={onSettings}
				/>
			</div>
			{/* A restart's word takes the path's place while it shows, so the
			    header never grows a line for it. */}
			{!offline && badge !== null ? (
				<PowerBadge />
			) : (
				wide &&
				snapshot && (
					<span className="truncate text-muted-foreground text-xs">
						{snapshot.path}
					</span>
				)
			)}
			{/* Out of the menu that asked, which has closed. */}
			<CheckpointRefusal className="pt-1" />
		</header>
	);
}
