import type {
	AutomationRow,
	Hook,
	Trigger,
} from "@stringsync/splates-server/hooks";
import {
	GARDENER_AUTOMATION,
	GROOMER_AUTOMATION,
} from "@stringsync/splates-server/hooks/browser";
import { useReactive } from "@webappwiz/react";
import {
	ChevronRightIcon,
	PauseIcon,
	PencilIcon,
	PlayIcon,
	XIcon,
} from "lucide-react";
import { type JSX, type ReactNode, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { AutoPickMark } from "./auto-pick-log";
import { AutomationDraft } from "./automation-draft";
import { AutomationFace, type RunOpens } from "./automation-face";
import { AddForm, AutomationForm } from "./automation-form";
import { AutomationList } from "./automation-list";
import { ReadFailed, ReadingNow } from "./countdown";
import {
	type Groom,
	GroomerForm,
	GroomerOff,
	groomerPick,
} from "./groomer-card";
import {
	GardenerForm,
	GardenerOff,
	gardenerPick,
	type SetGardener,
} from "./notes-gardener-card";
import { useReading } from "./page-readings";
import { PHONE_HEADING } from "./phone-rows";
import { Refusal } from "./refusal";
import { TopBar } from "./top-bar";

/**
 * The Automations page: what runs on a task event or a schedule while
 * `splates server` runs, each with when it last ran and for what task, which
 * `opens` opens, to edit, pause or remove, and a form to add one. The person's own come first; then those the project
 * checks in, which only `splates.config.ts` changes, and those splates
 * itself sets, as the groomer, whose agent is all that changes here, and
 * the notes gardener, whose agent and schedule do.
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
	const { rows, refusal, own, checkedIn, builtIn, groomer, notesGardener } =
		useReactive(
			list,
			(list) => ({
				rows: list.rows,
				refusal: list.refusal,
				own: list.own,
				checkedIn: list.checkedIn,
				builtIn: list.builtIn,
				groomer: list.groomer,
				notesGardener: list.notesGardener,
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
			{rows === null ? (
				refusal === null ? (
					<ReadingNow label="Reading automations…" />
				) : (
					<ReadFailed error={refusal} onRetry={() => void list.read()} />
				)
			) : (
				<>
					<Refusal refusal={refusal} />
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
						detail="Set by splates, which keeps what each is told. Removing the groomer turns it off, retiring its conversation; removing the notes gardener turns it off."
						rows={builtIn}
						opens={opens}
						onGroom={(pick) => list.groom(pick)}
						onGardener={(pick, schedule) => list.gardener(pick, schedule)}
						onPause={(row, paused) => void list.pause(row, paused)}
						onRemove={(row) => void list.remove(row)}
					>
						{groomer === null && (
							<GroomerOff onGroom={(pick) => list.groom(pick)} />
						)}
						{notesGardener === null && (
							<GardenerOff
								onGardener={(pick, schedule) => list.gardener(pick, schedule)}
							/>
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
	onGardener,
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
	onGardener?: SetGardener;
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
							onGardener={onGardener}
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
 * the groomer picks only its agent, and for the notes gardener its agent and
 * schedule.
 */
function Card({
	row,
	opens,
	onEdit,
	onGroom,
	onGardener,
	onPause,
	onRemove,
}: {
	row: AutomationRow;
	opens: RunOpens;
	onEdit?: Edit;
	onGroom?: Groom;
	onGardener?: SetGardener;
	onPause?: (row: AutomationRow, paused: boolean) => void;
	onRemove?: (row: AutomationRow) => void;
}): JSX.Element {
	const [editing, setEditing] = useState<AutomationDraft | null>(null);
	const [grooming, setGrooming] = useState(false);
	const [editingGardener, setEditingGardener] = useState(false);
	const adding = row.id === "";
	// Blank until the server labels what was added or saved.
	const pending = row.when === "";
	const paused = row.paused === true;
	// The groomer's agent, all of it the page edits; null for any other.
	const groomer = row.id === GROOMER_AUTOMATION ? groomerPick(row.hook) : null;
	// The notes gardener's agent; its schedule the page edits too.
	const gardener =
		row.id === GARDENER_AUTOMATION ? gardenerPick(row.hook) : null;
	if (editingGardener && gardener !== null && onGardener !== undefined) {
		return (
			<li aria-label={`automation ${row.id}`}>
				<GardenerForm
					pick={gardener}
					trigger={row.trigger}
					title="Edit the notes gardener"
					submit="Save"
					onSubmit={(picked, schedule) => {
						// Shown saved at once; a refusal is said above the list.
						setEditingGardener(false);
						void onGardener(picked, schedule);
					}}
					onCancel={() => setEditingGardener(false)}
				/>
			</li>
		);
	}
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
					(groomer !== null && onGroom !== undefined) ||
					(gardener !== null && onGardener !== undefined)) && (
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label="Edit"
						onClick={() =>
							groomer
								? setGrooming(true)
								: gardener
									? setEditingGardener(true)
									: setEditing(AutomationDraft.of(row))
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
