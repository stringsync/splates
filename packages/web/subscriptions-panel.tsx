import type { AutomationRow } from "@splates/server/hooks";
import { useReactive } from "core/react";
import {
	CheckIcon,
	ClockIcon,
	InfoIcon,
	PauseIcon,
	PlusIcon,
	TerminalIcon,
	ZapIcon,
} from "lucide-react";
import { type JSX, useEffect, useMemo, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { cn } from "#web/lib/utils.ts";
import { AutomationDraft } from "./automation-draft";
import type { RunOpens } from "./automation-face";
import { AutomationList } from "./automation-list";
import { ScheduledAutomations } from "./automations";
import { ReadFailed, ReadingNow } from "./countdown";
import { useReading } from "./page-readings";
import { listProjects } from "./project-api";
import { Refusal } from "./refusal";
import { type Subscribed, SubscriptionBook } from "./subscription-book";
import { SubscriptionForm } from "./subscription-form";
import {
	countsOf,
	FILTERS,
	type SubscriptionFilter,
	type SubscriptionState,
	stateOf,
	subscriptionsOf,
} from "./subscription-state";

/**
 * The Subscriptions tab of the Signals page: what runs when a signal
 * fires, a prompt in a fresh conversation or a shell command. Filter by
 * state, make one, edit, pause or remove it.
 */
export function SubscriptionsPanel({
	onCount,
	opens,
}: {
	/** Opens the task or conversation a run was for. */
	opens: RunOpens;
	/** Told how many subscriptions there are, for the tab's badge. */
	onCount?: (count: number) => void;
}): JSX.Element {
	const book = useReading("subscriptions", () => new SubscriptionBook());
	// The picked project's task-event and schedule automations, which the page lists under the signals.
	const list = useReading("automations", () => new AutomationList());
	useEffect(() => void list.read(), [list]);
	const { projects, current } = useProjectSlugs();
	useEffect(() => {
		if (projects !== null) {
			void book.load(projects);
		}
	}, [book, projects]);
	const { all, read, refusal } = useReactive(
		book,
		(book) => ({ all: book.all, read: book.read, refusal: book.refusal }),
		["changed"],
	);
	const [filter, setFilter] = useState<SubscriptionFilter>("all");
	const [project, setProject] = useState<string>(ALL_PROJECTS);
	const [editing, setEditing] = useState<Subscribed | "new" | null>(null);
	const [target, setTarget] = useState<string | null>(null);
	const own = useMemo(
		() => all.filter((each) => subscriptionsOf([each.row]).length > 0),
		[all],
	);
	useEffect(() => {
		if (read) {
			onCount?.(own.length);
		}
	}, [read, own, onCount]);
	if (!read) {
		return refusal === null ? (
			<ReadingNow label="Reading subscriptions…" />
		) : (
			<ReadFailed
				error={refusal}
				onRetry={() => projects !== null && void book.load(projects)}
			/>
		);
	}
	const inProject =
		project === ALL_PROJECTS
			? own
			: own.filter((each) => each.project === project);
	const counts = countsOf(inProject.map((each) => each.row));
	const visible = inProject.filter(
		(each) => filter === "all" || stateOf(each.row) === filter,
	);
	const several = (projects?.length ?? 0) > 1;
	const open = (next: Subscribed | "new") => {
		setTarget(
			next === "new"
				? project !== ALL_PROJECTS
					? project
					: (current ?? projects?.[0] ?? null)
				: next.project,
		);
		setEditing(next);
	};
	return (
		<section aria-label="subscriptions" className="flex flex-col gap-4">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<p className="text-muted-foreground text-sm">
					Run a prompt or command when a signal fires.
				</p>
				<Button size="sm" onClick={() => open("new")}>
					<PlusIcon /> New subscription
				</Button>
			</div>
			{several && (
				<label className="flex items-center gap-2 text-sm">
					<span className="font-medium">Project</span>
					<select
						aria-label="Filter by project"
						className="h-9 rounded-md border bg-background px-2 text-sm"
						value={project}
						onChange={(change) => setProject(change.target.value)}
					>
						<option value={ALL_PROJECTS}>All projects</option>
						{projects?.map((each) => (
							<option key={each} value={each}>
								{each}
							</option>
						))}
					</select>
				</label>
			)}
			<div role="tablist" aria-label="state" className="flex flex-wrap gap-1">
				{FILTERS.map((each) => (
					<button
						key={each}
						type="button"
						role="tab"
						aria-selected={filter === each}
						className={cn(
							"h-9 rounded-md px-3 text-sm capitalize",
							filter === each
								? "bg-muted font-medium"
								: "text-muted-foreground",
						)}
						onClick={() => setFilter(each)}
					>
						{each} <span className="tabular-nums">{counts[each]}</span>
					</button>
				))}
			</div>
			<Refusal refusal={refusal} />
			{visible.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					{inProject.length === 0
						? "No subscriptions yet."
						: `No ${filter} subscriptions.`}
				</p>
			) : (
				<ul className="flex flex-col gap-3">
					{visible.map((each) => (
						<Subscription
							key={`${each.project}/${each.row.id}`}
							row={each.row}
							project={several ? each.project : null}
							onEdit={() => open(each)}
							onPause={(paused) =>
								void book.pause(each.project, each.row, paused)
							}
							onRemove={() => void book.remove(each.project, each.row)}
						/>
					))}
				</ul>
			)}
			<p className="flex items-center gap-1.5 text-muted-foreground text-xs">
				<InfoIcon className="size-3.5" />
				Each prompt run starts a fresh conversation. Commands run in the
				project.
			</p>
			<ScheduledAutomations list={list} opens={opens} />
			<Dialog
				open={editing !== null}
				onOpenChange={(open) => !open && setEditing(null)}
			>
				<DialogContent className="max-sm:h-dvh max-sm:max-w-none max-sm:rounded-none">
					<DialogHeader>
						<DialogTitle>
							{editing === "new" ? "New subscription" : "Edit subscription"}
						</DialogTitle>
						<DialogDescription>
							Choose a signal and what happens when it fires.
						</DialogDescription>
					</DialogHeader>
					{editing !== null && target !== null && (
						<SubscriptionForm
							key={
								editing === "new"
									? "new"
									: `${editing.project}/${editing.row.id}`
							}
							draft={draftOf(editing === "new" ? "new" : editing.row)}
							submit={editing === "new" ? "Create subscription" : "Save"}
							projects={several ? (projects ?? []) : []}
							project={target}
							onProject={editing === "new" ? setTarget : undefined}
							onCancel={() => setEditing(null)}
							onSubmit={(trigger, hook, name) =>
								void (
									editing === "new"
										? book.add(target, trigger, hook, name)
										: book.edit(target, editing.row, trigger, hook, name)
								).then((saved) => saved && setEditing(null))
							}
						/>
					)}
				</DialogContent>
			</Dialog>
		</section>
	);
}

const ALL_PROJECTS = "";

/**
 * The slugs of every project that can be opened, and the one this page
 * shows; null until they are listed, none when listing fails.
 */
function useProjectSlugs(): {
	projects: string[] | null;
	current: string | null;
} {
	const [listed, setListed] = useState<{
		projects: string[];
		current: string | null;
	} | null>(null);
	useEffect(() => {
		let live = true;
		listProjects().then(
			({ projects }) => {
				const open = projects.filter((each) => !each.gone);
				const named = new URLSearchParams(location.search).get("project");
				const current =
					open.find((each) => each.slug === named) ??
					open.find((each) => each.focused) ??
					open[0];
				live &&
					setListed({
						projects: open.map((each) => each.slug),
						current: current?.slug ?? null,
					});
			},
			() => live && setListed({ projects: [], current: null }),
		);
		return () => {
			live = false;
		};
	}, []);
	return listed ?? { projects: null, current: null };
}

/** A new draft already on a signal, or one holding `row` to edit. */
function draftOf(editing: AutomationRow | "new"): AutomationDraft {
	if (editing !== "new") {
		return AutomationDraft.of(editing);
	}
	const draft = new AutomationDraft();
	draft.set("when", "signal");
	return draft;
}

const BADGE: Record<SubscriptionState, string> = {
	active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
	paused: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
	finished: "bg-muted text-muted-foreground",
};

function Subscription({
	row,
	project,
	onEdit,
	onPause,
	onRemove,
}: {
	row: AutomationRow;
	/** The project it belongs to, when the list spans several; else null. */
	project: string | null;
	onEdit: () => void;
	onPause: (paused: boolean) => void;
	onRemove: () => void;
}): JSX.Element {
	const [sure, setSure] = useState(false);
	const state = stateOf(row);
	const signal = "signal" in row.trigger ? row.trigger.signal : "";
	const Icon = row.finishedAt !== undefined ? ClockIcon : ZapIcon;
	return (
		<li className="flex flex-col gap-2 rounded-xl border p-4">
			<div className="flex items-center gap-3">
				<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
					{row.hook.kind === "run" ? (
						<TerminalIcon className="size-4" />
					) : (
						<Icon className="size-4" />
					)}
				</span>
				<span className="min-w-0 flex-1 truncate font-medium">
					{row.name ?? `Subscription ${row.id}`}
				</span>
				<span
					className={cn(
						"flex items-center gap-1 rounded-md px-2 py-0.5 text-xs capitalize",
						BADGE[state],
					)}
				>
					{state === "paused" && <PauseIcon className="size-3" />}
					{state === "finished" && <CheckIcon className="size-3" />}
					{state}
				</span>
			</div>
			{project !== null && (
				<p className="text-muted-foreground text-xs">Project {project}</p>
			)}
			<p className="text-sm">
				<span className="text-muted-foreground">On </span>
				<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
					{signal}
				</code>
			</p>
			<p className="truncate text-muted-foreground text-sm">{row.does}</p>
			{row.notice !== undefined && (
				<p
					role="status"
					className="rounded-lg bg-amber-500/10 px-3 py-2 text-amber-800 text-sm dark:text-amber-300"
				>
					{row.notice}. Edit the signal to resume.
				</p>
			)}
			<div className="flex flex-wrap items-center gap-1">
				<span className="text-muted-foreground text-xs">
					{row.hook.kind === "run" ? "Shell command" : "Prompt"}
					{row.runs.length > 0 && ` · ${row.runs.length} runs`}
				</span>
				<span className="ml-auto flex gap-1">
					{state !== "finished" && (
						<Button
							size="sm"
							variant="ghost"
							className="h-11 sm:h-8"
							onClick={() => onPause(state === "active")}
						>
							{state === "active" ? "Pause" : "Resume"}
						</Button>
					)}
					<Button
						size="sm"
						variant="ghost"
						className="h-11 sm:h-8"
						onClick={onEdit}
					>
						Edit
					</Button>
					<Button
						size="sm"
						variant="ghost"
						className="h-11 sm:h-8"
						onClick={() => (sure ? onRemove() : setSure(true))}
						onBlur={() => setSure(false)}
					>
						{sure ? "Are you sure?" : "Remove"}
					</Button>
				</span>
			</div>
		</li>
	);
}
