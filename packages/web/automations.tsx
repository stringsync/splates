import type { AutomationRow, Hook, Trigger } from "@splates/server/hooks";
import { GROOMER_AUTOMATION, runsNow } from "@splates/server/hooks/browser";
import { useReactive } from "core/react";
import {
	CirclePlayIcon,
	PauseIcon,
	PencilIcon,
	PlayIcon,
	XIcon,
} from "lucide-react";
import { type JSX, type ReactNode, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
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
import { AddForm, AutomationForm } from "./automation-form";
import type { AutomationList } from "./automation-list";
import {
	type Groom,
	GroomerForm,
	GroomerOff,
	groomerPick,
} from "./groomer-card";
import { PHONE_HEADING } from "./phone-rows";

/**
 * What runs on a task event or a schedule, under the Subscriptions tab's
 * signals: yours, the checked-in `on` commands and the built-in groomer, each
 * with when it last ran. Edit, pause or remove one (removing asks first), or
 * add one with the form. Pass `opens` to open a run's task or conversation.
 */
export function ScheduledAutomations({
	list,
	opens,
}: {
	list: AutomationList;
	opens: RunOpens;
}): JSX.Element | null {
	const { rows, own, checkedIn, builtIn, groomer, saving } = useReactive(
		list,
		(list) => ({
			saving: new Set(
				(list.rows ?? [])
					.filter((each) => list.isPending(each.id))
					.map((each) => each.id),
			),
			rows: list.rows,
			own: list.own.filter((each) => !("signal" in each.trigger)),
			checkedIn: list.checkedIn,
			builtIn: list.builtIn,
			groomer: list.groomer,
		}),
		["changed"],
	);
	if (rows === null) {
		return null;
	}
	return (
		<section
			aria-label="task events and schedules"
			className="flex min-w-0 flex-col gap-8"
		>
			<p className="text-muted-foreground text-sm">
				What runs on a task event or a schedule, while splates server runs. A
				schedule that came due while it was down runs once as it starts.
			</p>
			<Group
				title="Yours"
				detail="Kept on this machine, never checked in, since an agent spends your tokens."
				empty="None yet: add one below."
				rows={own}
				saving={saving}
				opens={opens}
				onEdit={(row, trigger, hook, name) =>
					list.edit(row, trigger, hook, name)
				}
				onPause={(row, paused) => void list.pause(row, paused)}
				onRun={(row) => void list.run(row)}
				onRemove={(row) => void list.remove(row)}
			/>
			{checkedIn.length > 0 && (
				<Group
					title="Checked in"
					detail="The `on` commands in splates.config.ts, which run for everyone on this project."
					rows={checkedIn}
					saving={saving}
					opens={opens}
				/>
			)}
			<Group
				title="Built in"
				detail="Set by splates, which keeps what each is told. Removing the groomer turns it off, retiring its conversation."
				rows={builtIn}
				saving={saving}
				opens={opens}
				onGroom={(pick) => list.groom(pick)}
				onPause={(row, paused) => void list.pause(row, paused)}
				onRun={(row) => void list.run(row)}
				onRemove={(row) => void list.remove(row)}
			>
				{groomer === null && (
					<GroomerOff onGroom={(pick) => list.groom(pick)} />
				)}
			</Group>
			<AddForm onAdd={(trigger, hook, name) => list.add(trigger, hook, name)} />
		</section>
	);
}

/** A heading and the automations under it, then any `children`. */
function Group({
	title,
	detail,
	empty,
	rows,
	saving,
	opens,
	onEdit,
	onGroom,
	onPause,
	onRun,
	onRemove,
	children,
}: {
	title: string;
	detail: string;
	empty?: string;
	rows: AutomationRow[];
	/** The ids of those with a change awaiting the server. */
	saving: ReadonlySet<string>;
	opens: RunOpens;
	onEdit?: Edit;
	onGroom?: Groom;
	onPause?: (row: AutomationRow, paused: boolean) => void;
	onRun?: (row: AutomationRow) => void;
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
							saving={saving.has(row.id)}
							opens={opens}
							onEdit={onEdit}
							onGroom={onGroom}
							onPause={onPause}
							onRun={onRun}
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
	name: string,
) => Promise<boolean>;

/**
 * One automation: what sets it off, what it runs, when it last ran, and its
 * buttons; or, while it is being edited, the form that edits it, which for
 * the groomer picks only its agent.
 */
function Card({
	row,
	saving,
	opens,
	onEdit,
	onGroom,
	onPause,
	onRun,
	onRemove,
}: {
	row: AutomationRow;
	/** Whether a change to it awaits the server. */
	saving: boolean;
	opens: RunOpens;
	onEdit?: Edit;
	onGroom?: Groom;
	onPause?: (row: AutomationRow, paused: boolean) => void;
	onRun?: (row: AutomationRow) => void;
	onRemove?: (row: AutomationRow) => void;
}): JSX.Element {
	const [editing, setEditing] = useState<AutomationDraft | null>(null);
	const [grooming, setGrooming] = useState(false);
	const [confirmingRemove, setConfirmingRemove] = useState(false);
	const adding = row.id === "";
	const pending = adding || saving;
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
						// Pending until the server answers; a refusal is said above the list.
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
					onSubmit={(trigger, hook, name) => {
						// Pending until the server answers; a refusal is said above the list.
						setEditing(null);
						void onEdit(row, trigger, hook, name);
					}}
					onCancel={() => setEditing(null)}
				/>
			</li>
		);
	}
	return (
		<li
			aria-label={`automation ${row.id || "being added"}`}
			aria-busy={pending}
			className={cn(
				"flex items-start gap-2 rounded-xl border bg-card p-3 shadow-xs",
				(paused || pending) && "opacity-60",
			)}
		>
			<AutomationFace row={row} opens={opens} saving={saving} />
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
			{!adding && onRun !== undefined && runsNow(row) && (
				<Button
					size="icon-sm"
					variant="ghost"
					aria-label="Run now"
					title="Run now"
					onClick={() => onRun(row)}
				>
					<CirclePlayIcon />
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
					onClick={() => setConfirmingRemove(true)}
				>
					<XIcon />
				</Button>
			)}
			{onRemove !== undefined && (
				<Dialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
					<DialogContent showCloseButton={false}>
						<DialogHeader>
							<DialogTitle>Remove this automation?</DialogTitle>
							<DialogDescription>
								Are you sure? It stops running and its schedule is lost.
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
									onRemove(row);
								}}
							>
								Remove
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</li>
	);
}
