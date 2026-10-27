import type { Ship } from "@stringsync/splates-server/ship";
import type { Snapshot } from "@stringsync/splates-server/tasks";
import {
	CircleAlertIcon,
	ExternalLinkIcon,
	KeyRoundIcon,
	PackageCheckIcon,
	PackageIcon,
} from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Duration } from "webappwiz/time";
import { buttonVariants } from "#web/components/ui/button.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import { BackgroundOutput } from "./background-output";
import { Output } from "./background-pane";
import { useNow } from "./hooks/use-now";
import { cn } from "./lib/utils";
import { STATUS_PILL } from "./status-pill";

/** How long a ship that ended still shows, for the person to see how it went. */
const SHOWN_AFTER = Duration.mins(60);

/**
 * The project's ship, while it runs and for an hour after it ends. Amber
 * while npm waits on the person, to sign in or for a publish's second factor,
 * and opening npm's page from there, on whichever device the page is on; it
 * opens what the ship prints, as it prints.
 */
export function ShipBadge({
	snapshot,
}: {
	snapshot: Snapshot | null;
}): JSX.Element | null {
	const ship = snapshot?.ship ?? null;
	const now = useNow(ship !== null, Duration.mins(1));
	const [open, setOpen] = useState(false);
	if (snapshot === null || ship === null || !shown(ship, now)) {
		return null;
	}
	const { label, icon, tone } = pillOf(ship);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger title={headingOf(ship)} className={cn(STATUS_PILL, tone)}>
				{icon}
				{label}
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-[28rem] max-w-[90vw] gap-2 p-3"
			>
				<p className="font-medium text-sm">{headingOf(ship)}</p>
				{ship.waiting !== null && (
					<div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-sm">
						<span className="min-w-0 flex-1">
							{ship.waiting.kind === "login"
								? "npm waits for you to sign in."
								: "npm waits for your second factor to publish."}
						</span>
						<a
							href={ship.waiting.url}
							target="_blank"
							rel="noreferrer"
							className={buttonVariants({ size: "sm" })}
						>
							<ExternalLinkIcon />
							Open
						</a>
					</div>
				)}
				{ship.status === "failed" && ship.error !== null && (
					<pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap">
						{ship.error}
					</pre>
				)}
				{/* Afresh for a ship started since. */}
				{open && <ShipOutput key={ship.started} project={snapshot.project} />}
			</PopoverContent>
		</Popover>
	);
}

/** What the project's latest ship prints, followed while it runs. */
function ShipOutput({ project }: { project: string }): JSX.Element {
	const [output] = useState(
		() =>
			new BackgroundOutput(
				`/api/ship/output?${new URLSearchParams({ project })}`,
			),
	);
	useEffect(() => () => output.dispose(), [output]);
	return (
		<Output
			output={output}
			className="h-64 overflow-hidden rounded-lg bg-[#0a0a0a] p-2"
		/>
	);
}

function shown(ship: Ship, now: number): boolean {
	return ship.ended === null || now - Date.parse(ship.ended) < SHOWN_AFTER.ms;
}

function headingOf(ship: Ship): string {
	switch (ship.status) {
		case "running":
			return `Shipping ${ship.project}${ship.from === null ? "" : ` from ${ship.from}`}`;
		case "done":
			return `Shipped ${ship.project}${ship.to === null ? "" : ` ${ship.to}`}`;
		case "failed":
			return `The ship of ${ship.project} failed`;
	}
}

function pillOf(ship: Ship): {
	label: string;
	icon: JSX.Element;
	tone: string;
} {
	if (ship.waiting !== null) {
		return {
			label: ship.waiting.kind === "login" ? "Sign in to npm" : "npm 2FA",
			icon: <KeyRoundIcon />,
			tone: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
		};
	}
	switch (ship.status) {
		case "running":
			return {
				label: "Shipping",
				icon: <PackageIcon />,
				tone: "bg-muted text-muted-foreground",
			};
		case "done":
			return {
				label: ship.to === null ? "Shipped" : `Shipped ${ship.to}`,
				icon: <PackageCheckIcon />,
				tone: "bg-muted text-muted-foreground",
			};
		case "failed":
			return {
				label: "Ship failed",
				icon: <CircleAlertIcon />,
				tone: "border-destructive/30 bg-destructive/10 text-destructive",
			};
	}
}
