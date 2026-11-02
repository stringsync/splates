import type { Snapshot } from "@splates/server/tasks";
import type { JSX, ReactNode } from "react";
import { cn } from "#web/lib/utils.ts";
import type { MachineStatus } from "./api";
import { CheckpointRefusal, PowerBadge, useCheckpoint } from "./checkpoint";
import { OfflineBanner } from "./freshness";
import { MachineBadge } from "./machine";
import { MergeBadge } from "./merge-badge";
import { ProjectSwitcher } from "./projects";
import { QueueBadge } from "./slot-queue";
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
		<header className="flex min-w-0 flex-col">
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
 * What every bar says after its title beside a sidebar: whether the page is
 * updating, the server's state, how a restart goes, and why a checkpoint could
 * not start. The offline banner sits below the bar instead.
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
	machine: MachineStatus | null;
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
