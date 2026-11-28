import type { AutomationRow } from "@splates/server/hooks";
import { runsNow } from "@splates/server/hooks/browser";
import { useReactive } from "core/react";
import {
	CirclePlayIcon,
	PauseIcon,
	PencilIcon,
	PlayIcon,
	PlusIcon,
	XIcon,
} from "lucide-react";
import { type JSX, useEffect, useMemo, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Card } from "#web/components/ui/card.tsx";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { cn } from "#web/lib/utils.ts";
import { AutomationDraft } from "./automation-draft";
import { AutomationFace, type RunOpens } from "./automation-face";
import { AutomationForm } from "./automation-form";
import { ReadFailed, ReadingNow } from "./countdown";
import { useReading } from "./page-readings";
import { PageSection } from "./page-section";
import { listProjects } from "./project-api";
import { Refusal } from "./refusal";
import { type Subscribed, SubscriptionBook } from "./subscription-book";
import {
	countsOf,
	FILTERS,
	kindOf,
	type SubscriptionFilter,
	stateOf,
	subscriptionsOf,
	TRIGGERS,
	type TriggerFilter,
	triggerCountsOf,
} from "./subscription-state";

/**
 * The Subscriptions tab of the Signals page: what runs when a signal fires,
 * a task event happens or a schedule comes due, a prompt in a fresh
 * conversation or a shell command. Filter by state, trigger and project;
 * make one, edit, run, pause or remove it. The checked-in `on` commands
 * list after, to read.
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
	const [trigger, setTrigger] = useState<TriggerFilter>("any");
	const [project, setProject] = useState<string>(ALL_PROJECTS);
	const [editing, setEditing] = useState<Subscribed | "new" | null>(null);
	const [target, setTarget] = useState<string | null>(null);
	const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
	const own = useMemo(
		() => all.filter((each) => subscriptionsOf([each.row]).length > 0),
		[all],
	);
	const checkedIn = useMemo(
		() => all.filter((each) => each.row.source === "config"),
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
	const inProject = (rows: Subscribed[]) =>
		project === ALL_PROJECTS
			? rows
			: rows.filter((each) => each.project === project);
	const mine = inProject(own);
	const counts = countsOf(mine.map((each) => each.row));
	const byState = mine.filter(
		(each) => filter === "all" || stateOf(each.row) === filter,
	);
	const triggerCounts = triggerCountsOf(byState.map((each) => each.row));
	const visible = byState.filter(
		(each) => trigger === "any" || kindOf(each.row.trigger) === trigger,
	);
	const config = inProject(checkedIn);
	const several = (projects?.length ?? 0) > 1;
	const open = (next: Subscribed | "new") => {
		setTarget(
			next === "new"
				? project !== ALL_PROJECTS
					? project
					: null
				: next.project,
		);
		setEditing(next);
	};
	// A new one opened before the projects were listed lands on the shown project once they are.
	const into = target ?? current ?? projects?.[0] ?? null;
	const keyOf = (each: Subscribed) => `${each.project}/${each.row.id}`;
	/** Marks `each` as saving until `change` settles. */
	const change = (each: Subscribed, change: Promise<boolean>) => {
		const key = keyOf(each);
		setSaving((was) => new Set(was).add(key));
		void change.finally(() =>
			setSaving((was) => {
				const next = new Set(was);
				next.delete(key);
				return next;
			}),
		);
	};
	return (
		<section aria-label="subscriptions" className="flex flex-col gap-4">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<p className="text-muted-foreground text-sm">
					Run a prompt or command when a signal fires, a task event happens, or
					a schedule comes due.
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
			<div className="flex flex-col gap-1">
				<Tabs
					label="state"
					tabs={FILTERS.map((each) => ({
						value: each,
						label: each,
						count: counts[each],
					}))}
					current={filter}
					onPick={setFilter}
					capitalize
				/>
				<Tabs
					label="trigger"
					tabs={TRIGGERS.map((each) => ({
						value: each.filter,
						label: each.label,
						count: each.filter === "any" ? null : triggerCounts[each.filter],
					}))}
					current={trigger}
					onPick={setTrigger}
				/>
			</div>
			<Refusal refusal={refusal} />
			{visible.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					{mine.length === 0
						? "No subscriptions yet."
						: "No subscriptions match these filters."}
				</p>
			) : (
				<ul className="flex flex-col gap-3">
					{visible.map((each) => (
						<SubscriptionCard
							key={keyOf(each)}
							row={each.row}
							project={several ? each.project : null}
							saving={saving.has(keyOf(each))}
							opens={opens}
							onEdit={() => open(each)}
							onRun={() => change(each, book.run(each.project, each.row))}
							onPause={(paused) =>
								change(each, book.pause(each.project, each.row, paused))
							}
							onRemove={() => change(each, book.remove(each.project, each.row))}
						/>
					))}
				</ul>
			)}
			<p className="text-muted-foreground text-xs">
				Each prompt run starts a fresh conversation. Commands run in the
				project. A schedule that came due while splates server was down runs
				once as it starts.
			</p>
			{config.length > 0 && (
				<PageSection
					title="Checked in"
					description="The `on` commands in splates.config.ts, which run for everyone on the project."
				>
					<ul className="flex flex-col gap-3">
						{config.map((each) => (
							<SubscriptionCard
								key={keyOf(each)}
								row={each.row}
								project={several ? each.project : null}
								saving={false}
								opens={opens}
							/>
						))}
					</ul>
				</PageSection>
			)}
			<Dialog
				open={editing !== null}
				onOpenChange={(open) => !open && setEditing(null)}
			>
				<DialogContent className="max-sm:h-dvh max-sm:max-w-none max-sm:content-start max-sm:overflow-y-auto max-sm:rounded-none sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>
							{editing === "new" ? "New subscription" : "Edit subscription"}
						</DialogTitle>
						<DialogDescription>
							Choose what sets it off and what happens then.
						</DialogDescription>
					</DialogHeader>
					{editing !== null && into !== null && (
						<AutomationForm
							key={editing === "new" ? "new" : keyOf(editing)}
							bare
							draft={draftOf(editing === "new" ? "new" : editing.row)}
							title={
								editing === "new" ? "New subscription" : "Edit subscription"
							}
							submit={editing === "new" ? "Create subscription" : "Save"}
							projects={several ? (projects ?? []) : []}
							project={into}
							onProject={editing === "new" ? setTarget : undefined}
							onCancel={() => setEditing(null)}
							onSubmit={(trigger, hook, name) =>
								void (
									editing === "new"
										? book.add(into, trigger, hook, name)
										: book.edit(into, editing.row, trigger, hook, name)
								).then((saved) => saved && setEditing(null))
							}
						/>
					)}
				</DialogContent>
			</Dialog>
		</section>
	);
}

/** A row of filter tabs, each with how many it shows when `count` is set. */
function Tabs<Value extends string>({
	label,
	tabs,
	current,
	onPick,
	capitalize = false,
}: {
	label: string;
	tabs: { value: Value; label: string; count: number | null }[];
	current: Value;
	onPick: (value: Value) => void;
	capitalize?: boolean;
}): JSX.Element {
	return (
		<div role="tablist" aria-label={label} className="flex flex-wrap gap-1">
			{tabs.map((each) => (
				<button
					key={each.value}
					type="button"
					role="tab"
					aria-selected={current === each.value}
					className={cn(
						"h-9 rounded-md px-3 text-sm",
						capitalize && "capitalize",
						current === each.value
							? "bg-muted font-medium"
							: "text-muted-foreground",
					)}
					onClick={() => onPick(each.value)}
				>
					{each.label}
					{each.count !== null && (
						<span className="tabular-nums"> {each.count}</span>
					)}
				</button>
			))}
		</div>
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

/**
 * One subscription: what sets it off, who or what it runs, its prompt as
 * Markdown, when it last ran, and its buttons; without `onEdit` and the
 * rest, as for a checked-in one, only to read.
 */
function SubscriptionCard({
	row,
	project,
	saving,
	opens,
	onEdit,
	onRun,
	onPause,
	onRemove,
}: {
	row: AutomationRow;
	/** The project it belongs to, when the list spans several; else null. */
	project: string | null;
	/** Whether a change to it awaits the server. */
	saving: boolean;
	opens: RunOpens;
	onEdit?: () => void;
	onRun?: () => void;
	onPause?: (paused: boolean) => void;
	onRemove?: () => void;
}): JSX.Element {
	const [confirmingRemove, setConfirmingRemove] = useState(false);
	const state = stateOf(row);
	return (
		<Card
			render={<li />}
			aria-label={`subscription ${row.name ?? row.id}`}
			aria-busy={saving}
			className={cn(
				"flex flex-col gap-2 p-3",
				(state !== "active" || saving) && "opacity-60",
			)}
		>
			<AutomationFace
				row={row}
				opens={opens}
				saving={saving}
				actions={
					<div className="-my-1 flex shrink-0 items-center">
						{!saving && onEdit !== undefined && (
							<Button
								size="icon-sm"
								variant="ghost"
								aria-label="Edit"
								onClick={onEdit}
							>
								<PencilIcon />
							</Button>
						)}
						{onRun !== undefined && runsNow(row) && (
							<Button
								size="icon-sm"
								variant="ghost"
								aria-label="Run now"
								title="Run now"
								onClick={onRun}
							>
								<CirclePlayIcon />
							</Button>
						)}
						{onPause !== undefined && state !== "finished" && (
							<Button
								size="icon-sm"
								variant="ghost"
								aria-label={state === "paused" ? "Resume" : "Pause"}
								onClick={() => onPause(state === "active")}
							>
								{state === "paused" ? <PlayIcon /> : <PauseIcon />}
							</Button>
						)}
						{onRemove !== undefined && (
							<Button
								size="icon-sm"
								variant="ghost"
								aria-label="Remove"
								onClick={() => setConfirmingRemove(true)}
							>
								<XIcon />
							</Button>
						)}
					</div>
				}
			/>
			{(project !== null || row.notice !== undefined) && (
				<div className="flex flex-col gap-2 sm:pl-11">
					{project !== null && (
						<p className="text-muted-foreground text-xs">Project {project}</p>
					)}
					{row.notice !== undefined && (
						<p
							role="status"
							className="rounded-lg bg-amber-500/10 px-3 py-2 text-amber-800 text-sm dark:text-amber-300"
						>
							{row.notice}. Edit the signal to resume.
						</p>
					)}
				</div>
			)}
			{onRemove !== undefined && (
				<Dialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
					<DialogContent showCloseButton={false}>
						<DialogHeader>
							<DialogTitle>Remove this subscription?</DialogTitle>
							<DialogDescription>
								Are you sure? It stops running and what sets it off is lost.
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<DialogClose render={<Button variant="outline" />}>
								Cancel
							</DialogClose>
							<Button
								variant="destructive"
								onClick={() => {
									setConfirmingRemove(false);
									onRemove();
								}}
							>
								Remove
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</Card>
	);
}
