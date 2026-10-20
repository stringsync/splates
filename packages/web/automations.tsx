import type { TaskStage } from "@stringsync/splates-server/board";
import type {
	AutomationRow,
	Hook,
	Trigger,
} from "@stringsync/splates-server/hooks";
import {
	GROOMER_AUTOMATION,
	TASK_EVENTS,
	type TaskEventName,
} from "@stringsync/splates-server/hooks/browser";
import { useReactive } from "@webappwiz/react";
import {
	ChevronRightIcon,
	PauseIcon,
	PencilIcon,
	PlayIcon,
	XIcon,
} from "lucide-react";
import {
	type FormEvent,
	type JSX,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Input } from "#web/components/ui/input.tsx";
import {
	NativeSelect,
	NativeSelectOption,
} from "#web/components/ui/native-select.tsx";
import { Textarea } from "#web/components/ui/textarea.tsx";
import { cn } from "#web/lib/utils.ts";
import { AutoPickMark } from "./auto-pick-log";
import { AutomationDraft, type When } from "./automation-draft";
import { AutomationFace, type RunOpens } from "./automation-face";
import { AutomationList } from "./automation-list";
import { Lanes } from "./conversation-names";
import { AssigneeMenu } from "./dispatching";
import {
	type Groom,
	GroomerForm,
	GroomerOff,
	groomerPick,
} from "./groomer-card";
import { useReading } from "./page-readings";
import { PHONE_HEADING } from "./phone-rows";
import { Refusal, useRefusal } from "./refusal";
import { TopBar } from "./top-bar";

const STAGES: TaskStage[] = ["backlog", "ready", "queued", "running"];

/**
 * The Automations page: what runs on a task event or a schedule while
 * `splates server` runs, each with when it last ran and for what task, which
 * `opens` opens, to edit, pause or remove, and a form to add one. The person's own come first; then those the project
 * checks in, which only `splates.config.ts` changes, and those splates
 * itself sets, as the groomer, whose agent is all that changes here.
 */
export function AutomationsPage({
	opens,
	onAutoPick,
}: {
	opens: RunOpens;
	/** Opens the Auto pick page, from its card. */
	onAutoPick: () => void;
}): JSX.Element {
	const list = useReading("automations", () => new AutomationList());
	useEffect(() => void list.read(), [list]);
	const { rows, refusal, own, checkedIn, builtIn, groomer } = useReactive(
		list,
		(list) => ({
			rows: list.rows,
			refusal: list.refusal,
			own: list.own,
			checkedIn: list.checkedIn,
			builtIn: list.builtIn,
			groomer: list.groomer,
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
			{/* Apart from the list, so it opens however reading that goes. */}
			<AutoPickCard onOpen={onAutoPick} />
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
						opens={opens}
						onEdit={(row, trigger, hook) => list.edit(row, trigger, hook)}
						onPause={(row, paused) => void list.pause(row, paused)}
						onRemove={(row) => void list.remove(row)}
					/>
					{checkedIn.length > 0 && (
						<Group
							title="Checked in"
							detail="The `on` commands in splates.config.ts, which run for everyone on this project."
							rows={checkedIn}
							opens={opens}
						/>
					)}
					<Group
						title="Built in"
						detail="Set by splates, which keeps what sets each off and what it is told. Removing the groomer turns it off, retiring its conversation."
						rows={builtIn}
						opens={opens}
						onGroom={(pick) => list.groom(pick)}
						onPause={(row, paused) => void list.pause(row, paused)}
						onRemove={(row) => void list.remove(row)}
					>
						{groomer === null && (
							<GroomerOff onGroom={(pick) => list.groom(pick)} />
						)}
					</Group>
				</>
			)}
			<AddForm onAdd={(trigger, hook) => list.add(trigger, hook)} />
		</section>
	);
}

/** Auto pick, as a card that opens its page of rules and log of picks. */
function AutoPickCard({ onOpen }: { onOpen: () => void }): JSX.Element {
	return (
		<button
			type="button"
			onClick={onOpen}
			className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left shadow-xs hover:bg-accent active:bg-accent"
		>
			<AutoPickMark className="size-8" />
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="font-medium text-sm">Auto pick</span>
				<span className="text-muted-foreground text-xs">
					Picks the agent, model and effort for a task started with none named,
					by the rules you set.
				</span>
			</span>
			<ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
		</button>
	);
}

/** A heading and the automations under it, then any `children`. */
function Group({
	title,
	detail,
	empty,
	rows,
	opens,
	onEdit,
	onGroom,
	onPause,
	onRemove,
	children,
}: {
	title: string;
	detail: string;
	empty?: string;
	rows: AutomationRow[];
	opens: RunOpens;
	onEdit?: Edit;
	onGroom?: Groom;
	onPause?: (row: AutomationRow, paused: boolean) => void;
	onRemove?: (row: AutomationRow) => void;
	children?: ReactNode;
}): JSX.Element {
	return (
		<div className="flex flex-col gap-3">
			<header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
				<h2 className={cn("font-medium text-sm", PHONE_HEADING)}>{title}</h2>
				<span className="text-muted-foreground text-xs">{detail}</span>
			</header>
			{rows.length === 0 && children == null ? (
				<p className="text-muted-foreground text-sm">{empty}</p>
			) : (
				<ul className="flex flex-col gap-3">
					{rows.map((row) => (
						<Card
							key={row.id || "adding"}
							row={row}
							opens={opens}
							onEdit={onEdit}
							onGroom={onGroom}
							onPause={onPause}
							onRemove={onRemove}
						/>
					))}
					{children}
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
 * One automation: what sets it off, what it runs, when it last ran, and its
 * buttons; or, while it is being edited, the form that edits it, which for
 * the groomer picks only its agent.
 */
function Card({
	row,
	opens,
	onEdit,
	onGroom,
	onPause,
	onRemove,
}: {
	row: AutomationRow;
	opens: RunOpens;
	onEdit?: Edit;
	onGroom?: Groom;
	onPause?: (row: AutomationRow, paused: boolean) => void;
	onRemove?: (row: AutomationRow) => void;
}): JSX.Element {
	const [editing, setEditing] = useState<AutomationDraft | null>(null);
	const [grooming, setGrooming] = useState(false);
	const adding = row.id === "";
	// Blank until the server labels what was added or saved.
	const pending = row.when === "";
	const paused = row.paused === true;
	// The groomer's agent, all of it the page edits; null for any other.
	const groomer = row.id === GROOMER_AUTOMATION ? groomerPick(row.hook) : null;
	if (grooming && groomer !== null && onGroom !== undefined) {
		return (
			<li aria-label={`automation ${row.id}`}>
				<GroomerForm
					pick={groomer}
					title="Edit the groomer"
					submit="Save"
					onSubmit={(picked) => {
						// Shown saved at once; a refusal is said above the list.
						setGrooming(false);
						void onGroom(picked);
					}}
					onCancel={() => setGrooming(false)}
				/>
			</li>
		);
	}
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
				"flex items-start gap-2 rounded-xl border bg-card p-3 shadow-xs",
				(paused || pending) && "opacity-60",
			)}
		>
			<AutomationFace row={row} opens={opens} />
			{!pending &&
				(onEdit !== undefined ||
					(groomer !== null && onGroom !== undefined)) && (
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label="Edit"
						onClick={() =>
							groomer ? setGrooming(true) : setEditing(AutomationDraft.of(row))
						}
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
