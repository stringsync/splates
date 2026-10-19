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
import { PauseIcon, PlayIcon, XIcon } from "lucide-react";
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
 * `splates server` runs, each with its last runs, to pause or remove, and a
 * form to add one. The person's own come first; then those the project
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
							detail="Set by splates, from Setup."
							rows={builtIn}
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
	onPause,
	onRemove,
}: {
	title: string;
	detail: string;
	empty?: string;
	rows: AutomationRow[];
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
							onPause={onPause}
							onRemove={onRemove}
						/>
					))}
				</ul>
			)}
		</div>
	);
}

/** One automation: what sets it off, what it runs, its last runs, and its buttons. */
function Card({
	row,
	onPause,
	onRemove,
}: {
	row: AutomationRow;
	onPause?: (row: AutomationRow, paused: boolean) => void;
	onRemove?: (row: AutomationRow) => void;
}): JSX.Element {
	const adding = row.id === "";
	const paused = row.paused === true;
	return (
		<li
			aria-label={`automation ${row.id || "being added"}`}
			className={cn(
				"flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-xs",
				(paused || adding) && "opacity-60",
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
						<span className="font-medium">{adding ? "Adding…" : row.when}</span>
						{paused && <Badge variant="secondary">Paused</Badge>}
					</div>
					<p className="break-words text-muted-foreground text-sm">
						{row.does}
					</p>
				</div>
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

/** The form that adds an automation: its trigger, then what it runs. */
function AddForm({
	onAdd,
}: {
	onAdd: (trigger: Trigger, hook: Hook) => Promise<boolean>;
}): JSX.Element {
	const lanes = useContext(Lanes);
	const [draft] = useState(() => new AutomationDraft());
	const { when, event, stage, lane, schedule, kind, pick, prompt, command } =
		useReactive(draft, (draft) => draft.fields, ["changed"]);
	const { refusal, refuse } = useRefusal();
	const submit = (form: FormEvent) => {
		form.preventDefault();
		let made: ReturnType<AutomationDraft["made"]>;
		try {
			made = draft.made();
		} catch (error) {
			refuse("Not added", error);
			return;
		}
		void onAdd(made.trigger, made.hook).then((added) => {
			if (added) {
				draft.added();
			}
		});
	};
	return (
		<form
			aria-label="add an automation"
			onSubmit={submit}
			className="flex flex-col gap-3 rounded-xl border p-3"
		>
			<h2 className={cn("font-medium text-sm", PHONE_HEADING)}>
				Add an automation
			</h2>
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
							onChange={(change) =>
								draft.set("stage", change.target.value as TaskStage | "")
							}
						>
							<NativeSelectOption value="">In any stage</NativeSelectOption>
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
			<Button type="submit" size="sm" className="self-start">
				Add
			</Button>
		</form>
	);
}
