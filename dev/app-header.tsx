import type { JSX, ReactNode } from "react";
import { cn } from "#dev/lib/utils.ts";
import type { MachineReading } from "../machine";
import type { Snapshot } from "../snapshot";
import { CheckpointRefusal, PowerBadge, useCheckpoint } from "./checkpoint";
import { MachineBadge } from "./machine";
import { ProjectSwitcher } from "./projects";

/**
 * Heads a phone's drawer, as tall as the bar beside it: the project
 * switcher and the server's state, then how a restart goes and why a
 * checkpoint could not start, under the row when they show. The page menu
 * is in every bar's kebab.
 */
export function AppHeader({
	name,
	snapshot,
	outdated,
	offline,
	machine,
}: {
	name: string;
	snapshot: Snapshot | null;
	/** Why a newer arbor has the server refusing, or null. */
	outdated: string | null;
	offline: boolean;
	machine: MachineReading | null;
}): JSX.Element {
	return (
		<header className="flex min-w-0 flex-col">
			<div className="flex h-(--top-bar-height) min-w-0 items-center gap-2 border-b px-4">
				<SlotMark snapshot={snapshot} />
				<ProjectSwitcher name={name} />
				<ServerBadges
					snapshot={snapshot}
					outdated={outdated}
					offline={offline}
					machine={machine}
				/>
			</div>
			<Restarting offline={offline} className="px-4 pb-2" />
		</header>
	);
}

/**
 * What every bar says after its title beside a sidebar: the server's state,
 * how a restart goes, and why a checkpoint could not start.
 */
export function AppStatus({
	snapshot,
	outdated,
	offline,
	machine,
}: {
	snapshot: Snapshot | null;
	outdated: string | null;
	offline: boolean;
	machine: MachineReading | null;
}): JSX.Element {
	return (
		<>
			<ServerBadges
				snapshot={snapshot}
				outdated={outdated}
				offline={offline}
				machine={machine}
			/>
			<Restarting offline={offline} className="min-w-0" />
		</>
	);
}

/**
 * Which `arbor dev --slot` this is, when several are open, or arbor's tree
 * for the one plain `arbor dev`.
 */
export function SlotMark({
	snapshot,
}: {
	snapshot: Snapshot | null;
}): JSX.Element {
	const slot = snapshot?.slot ?? null;
	return (
		<span
			role="img"
			aria-label={slot === null ? "arbor" : `slot ${slot.word}`}
			title={
				slot === null
					? "Served by arbor dev"
					: `Served by the ${slot.word} slot of arbor dev`
			}
			className="shrink-0 text-base leading-none"
		>
			{slot?.emoji ?? "🌳"}
		</span>
	);
}

/**
 * A badge when the server is outdated, unbuilt or offline, or the machine is
 * strained. Silent while connected, which is the normal case: once the server
 * stops answering the page says so, since what it shows may no longer be true.
 */
function ServerBadges({
	snapshot,
	outdated,
	offline,
	machine,
}: {
	snapshot: Snapshot | null;
	outdated: string | null;
	offline: boolean;
	machine: MachineReading | null;
}): JSX.Element {
	return (
		<>
			{/* Up but refusing: a newer arbor moved the records on. */}
			{outdated !== null && !offline && (
				<span role="status" title={outdated} className={WARNING}>
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
					className={WARNING}
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
		</>
	);
}

const WARNING =
	"flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-medium text-[11px] text-amber-600 leading-none dark:text-amber-400";

/** How a restart goes, and why a checkpoint could not start, while they show. */
function Restarting({
	offline,
	className,
}: {
	offline: boolean;
	className?: string;
}): ReactNode {
	const { badge, refusal } = useCheckpoint();
	if ((offline || badge === null) && refusal === null) {
		return null;
	}
	return (
		<div className={cn("flex min-w-0 items-center gap-2", className)}>
			{!offline && <PowerBadge />}
			{/* Out of the menu that asked, which has closed. */}
			<CheckpointRefusal />
		</div>
	);
}
