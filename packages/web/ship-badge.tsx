import { SHIP_KEY } from "@stringsync/splates-server/push/browser";
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
import { sendJson } from "./api";
import { BackgroundOutput } from "./background-output";
import { Output } from "./background-pane";
import { useNow } from "./hooks/use-now";
import { cn } from "./lib/utils";
import { STATUS_PILL } from "./status-pill";
import type { Opened } from "./worker";

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
	const [open, setOpen] = useState(openedByAddress);
	useEffect(() => {
		// Taken out once read, so a reload leaves the ship shut.
		const url = new URL(location.href);
		if (url.searchParams.has(SHIP_KEY)) {
			url.searchParams.delete(SHIP_KEY);
			history.replaceState(history.state, "", url);
		}
		const workers = navigator.serviceWorker;
		if (workers === undefined) {
			return;
		}
		const heard = (event: MessageEvent<Opened>) => {
			if (event.data?.type === "splates:open" && event.data.key === SHIP_KEY) {
				setOpen(true);
			}
		};
		workers.addEventListener("message", heard);
		return () => workers.removeEventListener("message", heard);
	}, []);
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
				{ship.waiting?.kind === "otp" && <OtpForm key={ship.waiting.since} />}
				{ship.waiting !== null && ship.waiting.url !== null && (
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

/** A field for the one-time password npm asks for; the code is sent, not kept. */
function OtpForm(): JSX.Element {
	const [code, setCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const submit = async () => {
		setError(null);
		try {
			await sendJson("/api/ship/otp", "POST", { code });
			setCode("");
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};
	return (
		<form
			className="flex flex-col gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-sm"
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<span>npm asks for your one-time password.</span>
			<div className="flex items-center gap-2">
				<input
					value={code}
					onChange={(event) => setCode(event.target.value)}
					inputMode="numeric"
					autoComplete="one-time-code"
					placeholder="123456"
					aria-label="One-time password"
					className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1"
				/>
				<button
					type="submit"
					disabled={code.trim() === ""}
					className={buttonVariants({ size: "sm" })}
				>
					Send
				</button>
			</div>
			{error !== null && (
				<span className="text-destructive text-xs">{error}</span>
			)}
		</form>
	);
}

/** Whether the address asks for the ship open, as a ship's push opens a new window with `?ship=open`. */
function openedByAddress(): boolean {
	return new URL(location.href).searchParams.get(SHIP_KEY) === "open";
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
			label:
				ship.waiting.kind === "login"
					? "Sign in to npm"
					: ship.waiting.kind === "otp"
						? "npm code"
						: "npm 2FA",
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
