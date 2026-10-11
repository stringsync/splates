import { CopyIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "#dev/components/ui/popover.tsx";
import type { Release } from "../release";
import { type Interrupted, showRelease } from "./api";
import { copy } from "./card";

/** What restarts `arbor dev` on the newest arbor. */
export const RESTART = "bunx @webappwiz/arbor@latest dev";

/**
 * A badge beside the project's name once a newer arbor is out, opening on how
 * to restart onto it and which conversations that would stop.
 */
export function ReleaseHint({ release }: { release: Release }): JSX.Element {
	// Null until the hint has asked: a list shown before then would say none.
	const [interrupted, setInterrupted] = useState<Interrupted[] | null>(null);
	return (
		<Popover
			onOpenChange={(open) => {
				if (open) {
					setInterrupted(null);
					showRelease().then(
						(state) => setInterrupted(state.interrupted),
						// The hint still says how to restart; only the list is missing.
						() => setInterrupted([]),
					);
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
				Update
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80">
				<PopoverHeader>
					<PopoverTitle>arbor {release.newest} is out</PopoverTitle>
					<PopoverDescription>
						This page runs {release.running}. Checkpoint every conversation, so
						each agent's ARBOR.md says where it stands, then restart:
					</PopoverDescription>
				</PopoverHeader>
				<div className="flex items-center gap-1 rounded-md bg-muted py-1 pr-1 pl-2">
					<code className="min-w-0 flex-1 truncate font-mono text-xs">
						{RESTART}
					</code>
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label="Copy the restart command"
						title="Copy"
						onClick={() => void copy(RESTART)}
					>
						<CopyIcon />
					</Button>
				</div>
				{interrupted !== null && interrupted.length > 0 && (
					<div className="flex flex-col gap-1">
						<span className="text-muted-foreground text-xs">
							A restart now stops:
						</span>
						<ul className="flex flex-col">
							{interrupted.map((each) => (
								<li key={each.id}>
									<a
										href={`/?project=${encodeURIComponent(each.project)}#conversations/${each.id}`}
										className="flex items-baseline gap-2 rounded-md px-1.5 py-1 hover:bg-muted"
									>
										<span className="min-w-0 flex-1 truncate">{each.name}</span>
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
			</PopoverContent>
		</Popover>
	);
}
