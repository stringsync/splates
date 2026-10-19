import type { TaskStage } from "@stringsync/splates-server/board";
import type {
	AutomationRow,
	Hook,
	Trigger,
} from "@stringsync/splates-server/hooks";
import {
	TASK_EVENTS,
	type TaskEventName,
} from "@stringsync/splates-server/hooks/browser";
import { useReactive } from "@webappwiz/react";
import { PauseIcon, PencilIcon, PlayIcon, XIcon } from "lucide-react";
import {
	type FormEvent,
	type JSX,
	useContext,
	useEffect,
	useState,
} from "react";
import { Badge } from "#web/components/ui/badge.tsx";
import { Button } from "#web/components/ui/button.tsx";
import { Input } from "#web/components/ui/input.tsx";
import {
	NativeSelect,
	NativeSelectOption,
} from "#web/components/ui/native-select.tsx";
import { Textarea } from "#web/components/ui/textarea.tsx";
import { cn } from "#web/lib/utils.ts";
import { AutomationDraft, type When } from "./automation-draft";
import { AutomationList } from "./automation-list";
import { Lanes } from "./conversation-names";
import { AssigneeMenu } from "./dispatching";
import { PHONE_HEADING } from "./phone-rows";
import { Refusal, useRefusal } from "./refusal";
import { Stamp } from "./stamp";
import { TopBar } from "./top-bar";

const STAGES: TaskStage[] = ["backlog", "ready", "queued", "running"];

/**
 * The Automations page: what runs on a task event or a schedule while
 * `splates server` runs, each with its last runs, to edit, pause or remove,
 * and a form to add one. The person's own come first; then those the project
 * checks in, and those splates itself sets, which only `splates.config.ts`
 * or Setup change.
 */
export function AutomationsPage(): JSX.Element {
	const [list] = useState(() => new AutomationList());
	useEffect(() => void list.read(), [list]);
	const { rows, refusal, own, checkedIn, builtIn } = useReactive(
		list,
		(list) => ({
			rows: list.rows,
			refusal: list.refusal,
			own: list.own,
			checkedIn: list.checkedIn,
			builtIn: list.builtIn,
		}),
		["changed"],
	);
	return (
		<section aria-label="automations" className="flex min-w-0 flex-col gap-8">
			<TopBar title="Automations" />
			<p className="text-muted-foreground text-sm">
				What runs on a task event or a schedule, while splates server runs. A
				schedule that came due while it was down runs once as it starts.
			</p>
			<Refusal refusal={refusal} />
			{rows === null ? (
				<p role="status" className="text-muted-foreground text-sm">
					Reading automations…
				</p>
			) : (
				<>
					<Group
						title="Yours"
						detail="Kept on this machine, never checked in, since an agent spends your tokens."
						empty="None yet: add one below."
						rows={own}
						onEdit={(row, trigger, hook) => list.edit(row, trigger, hook)}
						onPause={(row, paused) => void list.pause(row, paused)}
						onRemove={(row) => void list.remove(row)}
					/>
					{checkedIn.length > 0 && (
						<Group
							title="Checked in"
							detail="The `on` commands in splates.config.ts, which run for everyone on this project."
							rows={checkedIn}
						/>
					)}
					{builtIn.length > 0 && (
						<Group
							title="Built in"
							detail="Set by splates, from Setup. Removing the groomer turns it off, retiring its conversation; Setup turns it on again."
							rows={builtIn}
							onPause={(row, paused) => void list.pause(row, paused)}
							onRemove={(row) => void list.remove(row)}
						/>
					)}
				</>
			)}
			<AddForm onAdd={(trigger, hook) => list.add(trigger, hook)} />
		</section>
	);
}

/** A heading and the automations under it. */
function Group({
	title,
	detail,
	empty,
	rows,
	onEdit,
	onPause,
	onRemove,
}: {
	title: string;
	detail: string;
	empty?: string;
	rows: AutomationRow[];
	onEdit?: Edit;
	onPause?: (row: AutomationRow, paused: boolean) => void;
	onRemove?: (row: AutomationRow) => void;
}): JSX.Element {
	return (
		<div className="flex flex-col gap-3">
			<header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
				<h2 className={cn("font-medium text-sm", PHONE_HEADING)}>{title}</h2>
				<span className="text-muted-foreground text-xs">{detail}</span>
			</header>
			{rows.length === 0 ? (
				<p className="text-muted-foreground text-sm">{empty}</p>
			) : (
				<ul className="flex flex-col gap-3">
					{rows.map((row) => (
						<Card
							key={row.id || "adding"}
							row={row}
							onEdit={onEdit}
							onPause={onPause}
							onRemove={onRemove}
						/>
					))}
				</ul>
			)}
		</div>
	);
}

/** Saves `row` as setting off on `trigger` and running `hook`; says whether it took. */
type Edit = (
	row: AutomationRow,
	trigger: Trigger,
	hook: Hook,
) => Promise<boolean>;

/**
 * One automation: what sets it off, what it runs, its last runs, and its
 * buttons; or, while it is being edited, the form that edits it.
 */
function Card({
	row,
	onEdit,
	onPause,
	onRemove,
}: {
	row: AutomationRow;
	onEdit?: Edit;
	onPause?: (row: AutomationRow, paused: boolean) => void;
	onRemove?: (row: AutomationRow) => void;
}): JSX.Element {
	const [editing, setEditing] = useState<AutomationDraft | null>(null);
	const adding = row.id === "";
	// Blank until the server labels what was added or saved.
	const pending = row.when === "";
	const paused = row.paused === true;
	if (editing !== null && onEdit !== undefined) {
		return (
			<li aria-label={`automation ${row.id}`}>
				<AutomationForm
					draft={editing}
					title={`Edit automation ${row.id}`}
					submit="Save"
					onSubmit={(trigger, hook) => {
						// Shown saved at once; a refusal is said above the list.
						setEditing(null);
						void onEdit(row, trigger, hook);
					}}
					onCancel={() => setEditing(null)}
				/>
			</li>
		);
	}
	return (
		<li
			aria-label={`automation ${row.id || "being added"}`}
			className={cn(
				"flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-xs",
				(paused || pending) && "opacity-60",
			)}
		>
			<div className="flex items-start gap-2">
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<div className="flex flex-wrap items-center gap-2 text-sm">
						{!adding && (
							<span className="text-muted-foreground tabular-nums">
								{row.id}.
							</span>
						)}
						<span className="font-medium">
							{adding ? "Adding…" : pending ? "Saving…" : row.when}
						</span>
						{paused && <Badge variant="secondary">Paused</Badge>}
					</div>
					<p className="break-words text-muted-foreground text-sm">
						{row.does}
					</p>
				</div>
				{!pending && onEdit !== undefined && (
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label="Edit"
						onClick={() => setEditing(AutomationDraft.of(row))}
					>
						<PencilIcon />
					</Button>
				)}
				{!adding && onPause !== undefined && (
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label={paused ? "Resume" : "Pause"}
						onClick={() => onPause(row, !paused)}
					>
						{paused ? <PlayIcon /> : <PauseIcon />}
					</Button>
				)}
				{!adding && onRemove !== undefined && (
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label="Remove"
						onClick={() => onRemove(row)}
					>
						<XIcon />
					</Button>
				)}
			</div>
			{row.runs.length > 0 && (
				<ul aria-label="last runs" className="flex flex-col gap-0.5 text-xs">
					{row.runs.toReversed().map((run) => (
						<li key={run.at} className="flex min-w-0 items-baseline gap-2">
							<Stamp at={run.at} />
							<span className="text-muted-foreground">{run.on}</span>
							{run.error !== null && (
								<span className="min-w-0 truncate text-destructive">
									{run.error}
								</span>
							)}
						</li>
					))}
				</ul>
			)}
		</li>
	);
}

/** The form that adds an automation, clearing what was typed once it is added. */
function AddForm({
	onAdd,
}: {
	onAdd: (trigger: Trigger, hook: Hook) => Promise<boolean>;
}): JSX.Element {
	const [draft] = useState(() => new AutomationDraft());
	return (
		<AutomationForm
			draft={draft}
			title="Add an automation"
			submit="Add"
			onSubmit={(trigger, hook) =>
				void onAdd(trigger, hook).then((added) => {
					if (added) {
						draft.added();
					}
				})
			}
		/>
	);
}

/** The form that adds or edits an automation: its trigger, then what it runs. */
function AutomationForm({
	draft,
	title,
	submit,
	onSubmit,
	onCancel,
}: {
	draft: AutomationDraft;
	title: string;
	submit: string;
	onSubmit: (trigger: Trigger, hook: Hook) => void;
	onCancel?: () => void;
}): JSX.Element {
	const lanes = useContext(Lanes);
	const { when, event, stage, lane, schedule, kind, pick, prompt, command } =
		useReactive(draft, (draft) => draft.fields, ["changed"]);
	const { refusal, refuse } = useRefusal();
	const submitted = (form: FormEvent) => {
		form.preventDefault();
		let made: ReturnType<AutomationDraft["made"]>;
		try {
			made = draft.made();
		} catch (error) {
			refuse(`Not ${submit === "Add" ? "added" : "saved"}`, error);
			return;
		}
		onSubmit(made.trigger, made.hook);
	};
	return (
		<form
			aria-label={title.toLowerCase()}
			onSubmit={submitted}
			className="flex flex-col gap-3 rounded-xl border p-3"
		>
			<h2 className={cn("font-medium text-sm", PHONE_HEADING)}>{title}</h2>
			<div className="flex flex-wrap items-center gap-2">
				<NativeSelect
					aria-label="When"
					value={when}
					onChange={(change) => draft.set("when", change.target.value as When)}
				>
					<NativeSelectOption value="event">On a task event</NativeSelectOption>
					<NativeSelectOption value="every">Every so often</NativeSelectOption>
					<NativeSelectOption value="cron">On a cron line</NativeSelectOption>
				</NativeSelect>
				{when === "event" ? (
					<>
						<NativeSelect
							aria-label="Event"
							value={event}
							onChange={(change) =>
								draft.set("event", change.target.value as TaskEventName)
							}
						>
							{TASK_EVENTS.map((each) => (
								<NativeSelectOption key={each} value={each}>
									{each}
								</NativeSelectOption>
							))}
						</NativeSelect>
						<NativeSelect
							aria-label="Stage"
							value={stage}
							onChange={(change) => draft.set("stage", change.target.value)}
						>
							<NativeSelectOption value="">In any stage</NativeSelectOption>
							{stage.includes(",") && (
								<NativeSelectOption value={stage}>
									In {stage.split(",").join(" or ")}
								</NativeSelectOption>
							)}
							{STAGES.map((each) => (
								<NativeSelectOption key={each} value={each}>
									In {each}
								</NativeSelectOption>
							))}
						</NativeSelect>
						<NativeSelect
							aria-label="Lane"
							value={lane}
							onChange={(change) => draft.set("lane", change.target.value)}
						>
							<NativeSelectOption value="">In any lane</NativeSelectOption>
							{lane.includes(",") && (
								<NativeSelectOption value={lane}>
									In lane {lane.split(",").join(" or ")}
								</NativeSelectOption>
							)}
							{lanes.map((each) => (
								<NativeSelectOption key={each.id} value={String(each.id)}>
									{each.id} {each.name}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</>
				) : (
					<Input
						aria-label="Schedule"
						required
						className="w-48"
						placeholder={when === "every" ? "30m, 2h or 1d" : "0 9 * * 1-5"}
						value={schedule}
						onChange={(change) => draft.set("schedule", change.target.value)}
					/>
				)}
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<NativeSelect
					aria-label="Runs"
					value={kind}
					onChange={(change) =>
						draft.set("kind", change.target.value as Hook["kind"])
					}
				>
					<NativeSelectOption value="agent">Tell an agent</NativeSelectOption>
					<NativeSelectOption value="run">Run a command</NativeSelectOption>
				</NativeSelect>
				{kind === "agent" && (
					<AssigneeMenu
						assignee={pick}
						onPick={(picked) => draft.set("pick", picked)}
					/>
				)}
			</div>
			{kind === "agent" ? (
				<Textarea
					aria-label="Prompt"
					required
					placeholder="What the agent is told, after what set it off"
					value={prompt}
					onChange={(change) => draft.set("prompt", change.target.value)}
				/>
			) : (
				<Input
					aria-label="Command"
					required
					placeholder="Run with sh -c in the main tree"
					value={command}
					onChange={(change) => draft.set("command", change.target.value)}
				/>
			)}
			<Refusal refusal={refusal} />
			<div className="flex gap-2">
				<Button type="submit" size="sm">
					{submit}
				</Button>
				{onCancel !== undefined && (
					<Button type="button" size="sm" variant="ghost" onClick={onCancel}>
						Cancel
					</Button>
				)}
			</div>
		</form>
	);
}
