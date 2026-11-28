import type { Snapshot } from "@splates/server/tasks";
import type { JSX, ReactNode } from "react";
import { cn } from "#web/lib/utils.ts";
import type { MachineStatus } from "./api";
import { CheckpointRefusal, PowerBadge, useCheckpoint } from "./checkpoint";
import { OfflineBanner } from "./freshness";
import { MachineBadge } from "./machine";
import { MergeBadge } from "./merge-badge";
import { ProjectSwitcher } from "./projects";
import { QueueBadge } from "./start-queue";
import { STATUS_PILL } from "./status-pill";

/**
 * The head of a phone's drawer: the project switcher and the server's
 * state, with how a restart goes and why a checkpoint could not start under
 * them when they show. Pass the server's snapshot and machine reading.
 */
export function AppHeader({
	snapshot,
	name,
	outdated,
	offline,
	machine,
}: {
	/** The project's name. */
	name: string;
	snapshot: Snapshot | null;
	/** Why a newer splates has the server refusing, or null. */
	outdated: string | null;
	offline: boolean;
	machine: MachineStatus | null;
}): JSX.Element {
	return (
		<header className="flex min-w-0 shrink-0 flex-col">
			<div className="box-content flex h-(--top-bar-height) min-w-0 items-center gap-2 border-b px-4">
				<ProjectSwitcher
					name={name}
					path={false}
					servers={false}
					className="mx-0 min-w-0 max-w-full shrink"
				/>
				<ServerBadges
					snapshot={snapshot}
					outdated={outdated}
					offline={offline}
					machine={machine}
				/>
			</div>
			{offline && <OfflineBanner />}
			<Restarting offline={offline} className="px-4 pb-2" />
		</header>
	);
}

/**
 * Server status shown in the desktop top bar: outdated, build failed, routine
 * machine, merge, and queue badges, and active restart or checkpoint feedback.
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
	machine: MachineStatus | null;
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
 * Critical server alerts that always surface at the top edge: outdated or
 * build-failed server states.
 */
function CriticalBadges({
	snapshot,
	outdated,
	offline,
}: {
	snapshot: Snapshot | null;
	outdated: string | null;
	offline: boolean;
}): JSX.Element {
	return (
		<>
			{/* Up but refusing: a newer splates moved the records on. */}
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
					title="Building this page failed as splates server started, so it may be out of date: the terminal running splates server says why"
					className={WARNING}
				>
					<span className="size-1.5 rounded-full bg-amber-500" />
					Build failed
				</span>
			)}
		</>
	);
}

/**
 * Server badges inside the phone drawer header: critical alerts plus routine
 * machine, merge, and start-queue status.
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
	machine: MachineStatus | null;
}): JSX.Element {
	return (
		<>
			<CriticalBadges
				snapshot={snapshot}
				outdated={outdated}
				offline={offline}
			/>
			{!offline && <MachineBadge reading={machine} />}
			{!offline && <MergeBadge snapshot={snapshot} />}
			{!offline && <QueueBadge queue={machine?.queue ?? []} />}
		</>
	);
}

const WARNING = `${STATUS_PILL} border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400`;

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
