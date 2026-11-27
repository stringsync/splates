import type { Stuck } from "@splates/server/server";
import { RotateCwIcon, SendIcon, TriangleAlertIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverTitle,
	PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import { useCheckpoint } from "./checkpoint";
import { RefreshStatus, useFreshness } from "./freshness";
import { short } from "./release";

/** The bar's Update or Stuck button, or the current version when no update is available. */
export function RestartButton({
	wide,
	update,
	stuck = null,
	onInvestigateStuck,
}: {
	wide: boolean;
	update: boolean;
	stuck?: Stuck | null;
	onInvestigateStuck?: (stuck: Stuck) => Promise<void>;
}): JSX.Element | null {
	const { restart, restartBusy, restartDone, version, slide } = useCheckpoint();
	const { stale, unreachable } = useFreshness();
	if (stale && !unreachable && !restartBusy) {
		return <RefreshStatus />;
	}
	if (restartBusy) {
		return (
			<RefreshStatus
				updating
				description={
					slide === "going"
						? "Waiting for agents to save their progress before the server restarts."
						: slide === "restarting"
							? "Waiting for the updated server to reconnect. This page will reload when it is ready."
							: "Requesting a server update. The server will restart and this page will reload when it is ready."
				}
			/>
		);
	}
	const done = restartDone && !update;
	if (!update && !restartBusy && !done) {
		if (stuck !== null) {
			return <StuckButton stuck={stuck} onInvestigate={onInvestigateStuck} />;
		}
		return version === null || !wide ? null : (
			<span
				title={`Current version: splates ${version}`}
				className="shrink-0 whitespace-nowrap font-mono text-muted-foreground text-xs"
			>
				v{version}
			</span>
		);
	}
	const label = done ? "Updated" : "Update";
	return (
		<Button
			variant="outline"
			size="sm"
			// Opaque, so the bar's dotted band never shows through it.
			className="bg-card dark:bg-card dark:hover:bg-muted dark:active:bg-muted"
			aria-label={label}
			title={label}
			disabled={done}
			onClick={restart}
		>
			{!done && <RotateCwIcon aria-hidden data-icon="inline-start" />}
			<span>{label}</span>
		</Button>
	);
}

/**
 * Same-size amber control shown in the Update slot when the server's source
 * checkout is behind its upstream branch, opening a popover with the commit
 * count, dirty file count, and a Send to agent action.
 */
function StuckButton({
	stuck,
	onInvestigate,
}: {
	stuck: Stuck;
	onInvestigate?: (stuck: Stuck) => Promise<void>;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const commits = `${stuck.commits} server ${stuck.commits === 1 ? "commit" : "commits"}`;

	const send = async () => {
		if (onInvestigate === undefined || sending) {
			return;
		}
		setSending(true);
		setError(null);
		try {
			await onInvestigate(stuck);
			setOpen(false);
		} catch (failed) {
			setError(failed instanceof Error ? failed.message : String(failed));
		} finally {
			setSending(false);
		}
	};

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) {
					setError(null);
				}
			}}
		>
			<PopoverTrigger
				render={
					<Button
						variant="outline"
						size="sm"
						// Opaque, so the bar's dotted band never shows through it.
						className="border-amber-500/40 bg-amber-50 text-amber-700 hover:bg-amber-100/80 hover:text-amber-800 dark:border-amber-400/35 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900/80 dark:hover:text-amber-200"
					/>
				}
				aria-label="Update stuck"
				title={`Server checkout is ${commits} behind ${stuck.upstream}`}
			>
				<TriangleAlertIcon aria-hidden data-icon="inline-start" />
				<span>Stuck</span>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 gap-3">
				<PopoverTitle className="flex items-center gap-1.5">
					<TriangleAlertIcon
						aria-hidden
						className="size-4 shrink-0 text-amber-600 dark:text-amber-400"
					/>
					Server checkout is behind
				</PopoverTitle>
				<PopoverDescription>
					<strong className="font-semibold text-foreground">{commits}</strong>{" "}
					landed on{" "}
					<strong className="font-semibold text-foreground">
						{stuck.upstream}
					</strong>{" "}
					since this checkout (
					<code className="font-mono text-xs">{short(stuck.local)}</code>).
					Restarting will not pick them up until the checkout catches up.
				</PopoverDescription>
				{stuck.dirty > 0 && (
					<div className="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-amber-700 text-xs dark:text-amber-300">
						<TriangleAlertIcon aria-hidden className="size-3.5 shrink-0" />
						<span>
							{stuck.dirty} uncommitted{" "}
							{stuck.dirty === 1 ? "change" : "changes"} in{" "}
							{displayRoot(stuck.root)}
						</span>
					</div>
				)}
				{error !== null && (
					<p role="alert" className="text-destructive text-xs">
						{error}
					</p>
				)}
				{onInvestigate !== undefined && (
					<Button
						variant="outline"
						size="sm"
						className="w-full"
						disabled={sending}
						onClick={() => void send()}
					>
						<SendIcon aria-hidden data-icon="inline-start" />
						{sending ? "Sending…" : "Send to agent"}
					</Button>
				)}
			</PopoverContent>
		</Popover>
	);
}

/** Formats `root` with a leading `~` when it lives under a standard home directory. */
function displayRoot(root: string): string {
	return root.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}
