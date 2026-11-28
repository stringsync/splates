import type { RunState } from "@splates/server/ship";
import {
	BotIcon,
	CircleCheckIcon,
	CircleDashedIcon,
	CircleHelpIcon,
	CirclePauseIcon,
	CircleXIcon,
	GitMergeIcon,
	LinkIcon,
	SquareCheckBigIcon,
	WrenchIcon,
} from "lucide-react";
import type { JSX, ReactNode } from "react";
import { Card, CardContent } from "./components/ui/card";
import { cn } from "./lib/utils";
import { spanOf } from "./merge-lines";
import { todoAddress } from "./page-address";
import { PageSection } from "./page-section";
import { Spinner } from "./pending";
import type { SpawnedStatus, SpawnedWork } from "./ship-spawned-work";

type RunNote = RunState["notes"][number];

/**
 * The tasks and conversations a run spawned, one line apiece: where each
 * stands, its board task, its subject and its step. One that asks shows
 * its question and opens its conversation.
 */
export function SpawnedStrip({
	work,
}: {
	work: SpawnedWork[];
}): JSX.Element | null {
	if (work.length === 0) {
		return null;
	}
	return (
		<PageSection as="h3" title="Agents on this ship" aside={tally(work)}>
			<Card>
				<CardContent render={<ul />} className="flex flex-col gap-2.5">
					{work.map((each) => (
						<SpawnedLine
							key={`${each.todo ?? ""}\n${each.conversation ?? ""}`}
							work={each}
						/>
					))}
				</CardContent>
			</Card>
		</PageSection>
	);
}

function SpawnedLine({ work }: { work: SpawnedWork }): JSX.Element {
	const ended = !isOpen(work);
	const asking = work.status === "asking" || work.status === "review";
	const href =
		work.conversation !== undefined && (asking || work.todo === undefined)
			? `#conversations/${work.conversation}`
			: work.todo !== undefined
				? todoAddress(work.todo)
				: undefined;
	return (
		<li className="flex min-w-0 flex-col gap-0.5">
			<div className="flex min-w-0 items-center gap-2 text-sm">
				<SpawnedPill status={work.status} />
				{work.todo !== undefined && (
					<span className="shrink-0 font-mono text-muted-foreground text-xs">
						#{work.todo}
					</span>
				)}
				{work.kind === "fix" && (
					<WrenchIcon
						aria-label="Fix"
						className="size-3 shrink-0 text-muted-foreground"
					/>
				)}
				<a
					href={href}
					className={cn(
						"min-w-0 flex-1 truncate hover:underline",
						ended && "text-muted-foreground",
						work.status === "removed" && "line-through",
					)}
				>
					{work.subject}
				</a>
				{work.target !== undefined && (
					<span className="hidden shrink-0 text-muted-foreground text-xs sm:inline">
						{work.target}
						{work.step !== undefined && ` · ${work.step}`}
					</span>
				)}
			</div>
			{asking && work.line !== undefined && (
				<a
					href={href}
					className="ml-1 line-clamp-2 text-pretty border-amber-500/50 border-l-2 pl-2 text-foreground text-xs hover:underline"
				>
					{work.line}
				</a>
			)}
		</li>
	);
}

/** A pill saying where spawned work stands. */
export function SpawnedPill({
	status,
}: {
	status: SpawnedStatus;
}): JSX.Element {
	const { label, icon, tone } = STATUS[status];
	return (
		<span
			className={cn(
				"inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 font-medium text-[11px] leading-none [&_svg]:size-3",
				tone,
			)}
		>
			{icon}
			{label}
		</span>
	);
}

/** Whether `work` is still under way rather than ended. */
function isOpen(work: SpawnedWork): boolean {
	return !["merged", "removed", "ended"].includes(work.status);
}

/** How many of `work` are open, asking and ended, for the header. */
function tally(work: SpawnedWork[]): string {
	const open = work.filter(isOpen).length;
	const asking = work.filter(
		(each) => each.status === "asking" || each.status === "review",
	).length;
	const parts = [`${open} open`];
	if (asking > 0) {
		parts.push(`${asking} waiting on you`);
	}
	if (open < work.length) {
		parts.push(`${work.length - open} ended`);
	}
	return parts.join(" · ");
}

/**
 * What agents added to the run, newest first, on a rail: each note's author
 * and the step it is about as chips, its words, and its link.
 */
export function RunNotes({ notes }: { notes: RunNote[] }): JSX.Element | null {
	if (notes.length === 0) {
		return null;
	}
	const newest = [...notes].reverse();
	return (
		<PageSection as="h3" title="Notes" count={notes.length}>
			<Card>
				<CardContent render={<ol />} className="flex flex-col py-1.5">
					{newest.map((note, index) => (
						<li
							key={`${note.at}\n${note.task}\n${note.text}`}
							className="relative flex gap-3 py-3"
						>
							<div className="relative flex w-4 shrink-0 justify-center">
								<span className="mt-1.5 size-2 rounded-full bg-foreground/70 ring-4 ring-card" />
								{index < newest.length - 1 && (
									<span className="absolute top-4 -bottom-2.5 w-px bg-border" />
								)}
							</div>
							<div className="flex min-w-0 flex-1 flex-col gap-1">
								<div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
									<a
										href={`#tasks/${note.task}`}
										className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] text-foreground/90 hover:bg-muted"
									>
										<BotIcon
											aria-hidden
											className="size-3 text-muted-foreground"
										/>
										{note.task}
									</a>
									<span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
										{note.target === undefined
											? "Whole run"
											: `${note.target} · ${note.step}`}
									</span>
									<span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
										{spanOf(Date.now() - note.at)} ago
									</span>
								</div>
								<p className="whitespace-pre-wrap text-pretty text-sm leading-relaxed">
									{note.text}
								</p>
								{note.link !== undefined && <NoteLink link={note.link} />}
							</div>
						</li>
					))}
				</CardContent>
			</Card>
		</PageSection>
	);
}

/** A note's link as a chip: `#2851` opens the task, a URL opens itself. */
function NoteLink({ link }: { link: string }): JSX.Element {
	const look =
		"inline-flex w-fit max-w-full items-center gap-1 truncate rounded-md border px-1.5 py-0.5 text-[11px] text-foreground/90 hover:bg-muted";
	const task = /^#(\d+)$/.exec(link);
	if (task?.[1] !== undefined) {
		return (
			<a className={look} href={todoAddress(Number(task[1]))}>
				<SquareCheckBigIcon
					aria-hidden
					className="size-3 text-muted-foreground"
				/>
				Task {link}
			</a>
		);
	}
	return /^https?:\/\//.test(link) ? (
		<a className={look} href={link} rel="noreferrer" target="_blank">
			<LinkIcon aria-hidden className="size-3 text-muted-foreground" />
			<span className="truncate">{link.replace(/^https?:\/\//, "")}</span>
		</a>
	) : (
		<span className={look}>{link}</span>
	);
}

const SKY = "text-sky-700 border-sky-600/30 bg-sky-500/10 dark:text-sky-300";
const MUTED = "text-muted-foreground border-border";

const STATUS: Record<
	SpawnedStatus,
	{ label: string; icon: ReactNode; tone: string }
> = {
	queued: {
		label: "Queued",
		icon: <CircleDashedIcon aria-hidden />,
		tone: MUTED,
	},
	working: {
		label: "Working",
		icon: <Spinner aria-hidden className="animate-spin" />,
		tone: SKY,
	},
	asking: {
		label: "Asks you",
		icon: <CircleHelpIcon aria-hidden />,
		tone: "text-amber-800 border-amber-600/40 bg-amber-500/15 dark:text-amber-300",
	},
	review: {
		label: "Ready to merge",
		icon: <SquareCheckBigIcon aria-hidden />,
		tone: "text-violet-700 border-violet-600/30 bg-violet-500/10 dark:text-violet-300",
	},
	merging: { label: "Merging", icon: <GitMergeIcon aria-hidden />, tone: SKY },
	idle: { label: "Idle", icon: <CirclePauseIcon aria-hidden />, tone: MUTED },
	merged: {
		label: "Merged",
		icon: <CircleCheckIcon aria-hidden />,
		tone: "text-green-700 border-green-600/30 bg-green-500/10 dark:text-green-300",
	},
	removed: { label: "Removed", icon: <CircleXIcon aria-hidden />, tone: MUTED },
	ended: { label: "Ended", icon: <CircleCheckIcon aria-hidden />, tone: MUTED },
};
