import type { Snapshot } from "@splates/server/tasks";
import type { LucideIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import { Badge } from "#web/components/ui/badge.tsx";
import { cn } from "#web/lib/utils.ts";
import { openRequests } from "./creds";
import type { Page } from "./page-route";
import { SetupContext } from "./setup-state";
import { useAutopickImprovements } from "./use-autopick-improvements";
import {
	useShipFailed,
	useShipRecapReady,
	useShipsRunning,
	useShipsWaiting,
} from "./use-ships-waiting";

/** Status decoration attached to a navigation item's leading icon. */
export type NavIconStatus =
	| { kind: "attention"; label: string }
	| { kind: "running"; label: string }
	| { kind: "failed"; label: string }
	| { kind: "done"; label: string };

/** Trailing count badge shown on a navigation item. */
export interface NavCountStatus {
	count: number;
	tone: "warning" | "muted";
	label: string;
}

/** Combined icon and count status for one navigation item. */
export interface NavPageStatus {
	icon?: NavIconStatus;
	badge?: NavCountStatus;
}

/**
 * Returns the live status decorations and count badges for navigation pages
 * so the desktop sidebar and mobile drawer stay identical.
 */
export function useNavStatuses(
	snapshot: Snapshot | null,
): Partial<Record<Page, NavPageStatus>> {
	const requested =
		snapshot !== null && openRequests(snapshot.creds).length > 0;
	const { progress } = useContext(SetupContext);
	const setupRequired = progress?.required === true;
	const improvements = useAutopickImprovements()?.count ?? 0;
	const asking = useShipsWaiting().length;
	const shipsRunning = useShipsRunning();
	const shipFailed = useShipFailed();
	const shipRecapReady = useShipRecapReady();

	const statuses: Partial<Record<Page, NavPageStatus>> = {};

	if (requested) {
		statuses.creds = {
			icon: { kind: "attention", label: "creds requested" },
		};
	}

	if (setupRequired) {
		statuses.setup = {
			icon: { kind: "attention", label: "setup unfinished" },
		};
	}

	if (improvements > 0) {
		statuses["auto-pick"] = {
			badge: {
				count: improvements,
				tone: "muted",
				label: `${improvements} possible ${improvements === 1 ? "improvement" : "improvements"}`,
			},
		};
	}

	const shipIcon: NavIconStatus | undefined = shipsRunning
		? { kind: "running", label: "a ship runs" }
		: shipFailed
			? { kind: "failed", label: "Ship stopped on a failure" }
			: shipRecapReady
				? { kind: "done", label: "Ship succeeded, recap unread" }
				: undefined;
	const shipBadge: NavCountStatus | undefined =
		asking > 0
			? {
					count: asking,
					tone: "warning",
					label: `${asking} waiting on you`,
				}
			: undefined;

	if (shipIcon !== undefined || shipBadge !== undefined) {
		statuses.ships = { icon: shipIcon, badge: shipBadge };
	}

	return statuses;
}

/**
 * Leading navigation icon with an optional corner decoration ringed in the
 * sidebar surface color.
 */
export function NavIcon({
	icon: Icon,
	status,
	size = "default",
}: {
	icon: LucideIcon;
	status?: NavIconStatus;
	/** Matches the desktop sidebar (`default`) or mobile drawer (`lg`) icon scale. */
	size?: "default" | "lg";
}): JSX.Element {
	return (
		<span className="relative flex shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none group-hover/navrow:scale-110 group-active/navrow:scale-95">
			<Icon
				data-nav-icon=""
				className={cn(status?.kind === "failed" && "!text-destructive")}
			/>
			{status !== undefined && <NavIconBadge status={status} size={size} />}
		</span>
	);
}

/** Trailing shadcn count badge for navigation items. */
export function NavCountBadge({
	count,
	tone,
	label,
	size = "default",
}: {
	count: number;
	tone: "warning" | "muted";
	/** Accessible status label when the badge reports a live count. */
	label?: string;
	/** Matches the desktop sidebar (`default`) or mobile drawer (`lg`) row scale. */
	size?: "default" | "lg";
}): JSX.Element {
	return (
		<Badge
			variant={tone === "muted" ? "secondary" : "outline"}
			role={label === undefined ? undefined : "status"}
			aria-label={label}
			className={cn(
				"min-w-5 rounded-sm! px-1.5 font-medium tabular-nums",
				size === "lg" && "h-5.5 min-w-5.5 px-1.75",
				tone === "muted"
					? "border-transparent text-muted-foreground"
					: "border-warning/30 bg-warning/15 text-[color-mix(in_oklab,var(--warning)_72%,var(--foreground))]",
			)}
		>
			{count}
		</Badge>
	);
}

const DOT_COLORS = {
	attention: "bg-warning",
	failed: "bg-destructive",
	done: "bg-success",
} as const;

function NavIconBadge({
	status,
	size,
}: {
	status: NavIconStatus;
	size: "default" | "lg";
}): JSX.Element {
	if (status.kind === "running") {
		return (
			<span
				role="status"
				aria-label={status.label}
				className={cn(
					"absolute flex items-center justify-center rounded-full bg-sidebar ring-[1.5px] ring-sidebar",
					size === "lg"
						? "-right-1 -bottom-0.75 size-2.75"
						: "-right-0.75 -bottom-0.5 size-2.25",
				)}
			>
				<span
					aria-hidden
					className={cn(
						"size-full animate-spin rounded-full border-info/25 border-t-info border-r-info motion-reduce:animate-none",
						size === "lg" ? "border-[1.75px]" : "border-[1.5px]",
					)}
				/>
			</span>
		);
	}
	const dotClass = cn(
		"-top-0.5 -right-0.5 absolute rounded-full ring-2 ring-sidebar",
		size === "lg" ? "size-2.25" : "size-2",
		DOT_COLORS[status.kind],
	);
	if (status.kind === "attention") {
		return <span role="img" aria-label={status.label} className={dotClass} />;
	}
	return <span role="status" aria-label={status.label} className={dotClass} />;
}
