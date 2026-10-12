import {
	CheckIcon,
	CircleAlertIcon,
	CopyIcon,
	Loader2Icon,
} from "lucide-react";
import { type JSX, useCallback, useEffect, useState } from "react";
import { Duration, SystemTimer } from "webappwiz/time";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "#dev/components/ui/popover.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Checkpoint } from "../conversations";
import type { Behind, Release } from "../release";
import { checkpointAll, type Interrupted, showRelease } from "./api";
import { short } from "./auto-restart";
import { useCopy } from "./card";

/** What restarts `arbor dev` on the newest arbor. */
export const RESTART = "bunx @webappwiz/arbor@latest dev";

/**
 * A badge beside the project's name once a newer arbor is out, or once
 * commits have landed on the source `arbor dev` runs from, opening on how to
 * restart onto it and which conversations that would stop.
 */
export function ReleaseHint({
	release,
	behind,
}: {
	release: Release | null;
	behind: Behind | null;
}): JSX.Element {
	// Null until the hint has asked: a list shown before then would say none.
	const [interrupted, setInterrupted] = useState<Interrupted[] | null>(null);
	const [open, setOpen] = useState(false);
	const [refused, setRefused] = useState<string | null>(null);
	const { copied, copy } = useCopy();
	const refresh = useCallback(
		() =>
			showRelease().then(
				(state) => setInterrupted(state.interrupted),
				// The hint still says how to restart; only the list is missing.
				() => setInterrupted((shown) => shown ?? []),
			),
		[],
	);
	const checkpointing =
		interrupted?.some((each) => each.checkpoint === "asked") ?? false;
	// Asked again while agents checkpoint, for each to show when it is done.
	useEffect(() => {
		if (!open || !checkpointing) {
			return;
		}
		const tick = new SystemTimer().setInterval(
			() => void refresh(),
			Duration.secs(1),
		);
		return () => tick.dispose();
	}, [open, checkpointing, refresh]);
	return (
		<Popover
			onOpenChange={(opened) => {
				setOpen(opened);
				if (opened) {
					setInterrupted(null);
					setRefused(null);
					void refresh();
				}
			}}
		>
			<PopoverTrigger
				render={
					<button
						type="button"
						className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 font-medium text-[11px] text-sky-600 leading-none hover:bg-sky-500/20 dark:text-sky-400"
					/>
				}
			>
				<span className="size-1.5 rounded-full bg-sky-500" />
				{behind !== null ? "Restart" : "Update"}
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80">
				<PopoverHeader>
					<PopoverTitle>
						{behind !== null
							? `arbor's source is at ${short(behind.newest)}`
							: `arbor ${release?.newest} is out`}
					</PopoverTitle>
					<PopoverDescription>
						This page runs{" "}
						{behind !== null ? short(behind.running) : release?.running}.
						Checkpoint every conversation, so each agent's ARBOR.md says where
						it stands, then restart
						{behind !== null ? " from Checkpoint in the sidebar" : ""}.
					</PopoverDescription>
				</PopoverHeader>
				{interrupted !== null && interrupted.length > 0 && (
					<div className="flex flex-col gap-1">
						<div className="flex items-center gap-2">
							<span className="flex-1 text-muted-foreground text-xs">
								A restart now stops:
							</span>
							<Button
								size="xs"
								variant="outline"
								disabled={checkpointing}
								onClick={() => {
									setRefused(null);
									checkpointAll().then(refresh, (error: Error) =>
										setRefused(error.message),
									);
								}}
							>
								{checkpointing ? "Checkpointing" : "Checkpoint all"}
							</Button>
						</div>
						{refused !== null && (
							<span className="text-destructive text-xs">{refused}</span>
						)}
						<ul className="flex flex-col">
							{interrupted.map((each) => (
								<li key={each.id}>
									<a
										href={`/?project=${encodeURIComponent(each.project)}#conversations/${each.id}`}
										className="flex items-baseline gap-2 rounded-md px-1.5 py-1 hover:bg-muted"
									>
										<span className="min-w-0 flex-1 truncate">{each.name}</span>
										{each.checkpoint !== null && (
											<CheckpointState checkpoint={each.checkpoint} />
										)}
										<span className="shrink-0 text-muted-foreground text-xs">
											{each.project}
										</span>
									</a>
								</li>
							))}
						</ul>
					</div>
				)}
				{interrupted !== null && interrupted.length === 0 && (
					<span className="text-muted-foreground text-xs">
						No conversation is live.
					</span>
				)}
				{behind === null && (
					<div className="flex items-center gap-1 rounded-md bg-muted py-1 pr-1 pl-2">
						<code className="min-w-0 flex-1 truncate font-mono text-xs">
							{RESTART}
						</code>
						<Button
							size="icon-xs"
							variant="ghost"
							aria-label="Copy the restart command"
							title={
								copied.state === "copied"
									? "Copied"
									: copied.state === "failed"
										? `Not copied: ${copied.error}`
										: "Copy"
							}
							onClick={() => copy(RESTART)}
						>
							{copied.state === "copied" ? <CheckIcon /> : <CopyIcon />}
						</Button>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}

const SAYS: Record<Checkpoint, string> = {
	asked: "Checkpointing",
	done: "Checkpointed",
	failed: "Failed",
	unanswered: "No response",
};

/**
 * How far one conversation's checkpoint has got, as an icon, the word in its
 * name and tooltip.
 */
export function CheckpointState({
	checkpoint,
}: {
	checkpoint: Checkpoint;
}): JSX.Element {
	return (
		<span
			role="img"
			aria-label={SAYS[checkpoint]}
			title={SAYS[checkpoint]}
			className={cn(
				"flex shrink-0 self-center",
				checkpoint === "done"
					? "text-success"
					: checkpoint === "asked"
						? "text-muted-foreground"
						: "text-destructive",
			)}
		>
			{checkpoint === "asked" ? (
				<Loader2Icon className="size-3.5 animate-spin" />
			) : checkpoint === "done" ? (
				<CheckIcon className="size-3.5" />
			) : (
				<CircleAlertIcon className="size-3.5" />
			)}
		</span>
	);
}
