import type { WorkerListing } from "@stringsync/splates-server/workers";
import {
	AlarmClockIcon,
	PauseIcon,
	PlayIcon,
	Trash2Icon,
	TriangleAlertIcon,
} from "lucide-react";
import { type JSX, type ReactNode, useState } from "react";
import { Badge } from "#web/components/ui/badge.tsx";
import { Button } from "#web/components/ui/button.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { useMinute } from "./hooks/use-minute";
import { ago } from "./plan-limits";
import { Refusal } from "./refusal";

/** A worker not this machine's: as `splates worker list` says it, with its actions. */
export function WorkerCard({
	worker,
	updating,
	frame,
	refusal,
	onDrain,
	onWake,
	onSlots,
	onRemove,
}: {
	worker: WorkerListing;
	updating: boolean;
	frame: WorkerCardFrame;
	refusal: string | undefined;
	onDrain: (draining: boolean) => void;
	/** Wakes it, asleep at home. */
	onWake: () => void;
	onSlots: (slots: number) => void;
	onRemove: (force: boolean) => void;
}): JSX.Element {
	const now = useMinute();
	const { used } = worker.slots;
	const line = [
		worker.kind,
		worker.lastHeard === null ? null : `heard ${ago(worker.lastHeard, now)}`,
	]
		.filter((part) => part !== null)
		.join(", ");
	return (
		<WorkerShell
			label={`worker ${worker.id}`}
			title={<WorkerName id={worker.id} />}
			line={line}
			badges={<Health worker={worker} />}
			worker={worker}
			updating={updating}
			frame={frame}
			onSlots={onSlots}
			refusal={refusal}
			actions={
				<>
					{worker.health === "asleep" && (
						<Button
							variant="ghost"
							size="sm"
							title="Sends the packet that wakes it, from a worker on its network"
							onClick={onWake}
						>
							<AlarmClockIcon /> Wake
						</Button>
					)}
					{!worker.removing &&
						(worker.draining ? (
							<Button
								variant="ghost"
								size="sm"
								title="Takes new agents again"
								onClick={() => onDrain(false)}
							>
								<PlayIcon /> Resume
							</Button>
						) : (
							<Button
								variant="ghost"
								size="sm"
								title="Takes no new agents; those on it run to their end"
								onClick={() => onDrain(true)}
							>
								<PauseIcon /> Drain
							</Button>
						))}
					{worker.removing ? (
						<Button
							variant="ghost"
							size="sm"
							className="text-destructive hover:text-destructive"
							title={`Ends the ${used} running on it now`}
							onClick={() => onRemove(true)}
						>
							<TriangleAlertIcon /> Remove now
						</Button>
					) : (
						<Button
							variant="ghost"
							size="sm"
							className="text-muted-foreground hover:text-destructive"
							title={
								used > 0
									? "Drains it, and removes it once what runs on it ends"
									: "Revokes its key and forgets it"
							}
							onClick={() => onRemove(false)}
						>
							<Trash2Icon /> Remove
						</Button>
					)}
				</>
			}
		/>
	);
}

/** What a worker's tasks and keys open, and where its actions are refused. */
export interface WorkerCardFrame {
	/** The tasks of this project, which a worker's tasks open on the Tasks page. */
	tasks: ReadonlySet<string>;
	onOpenTask: (name: string) => void;
	/** The names of the key providers, by id; a provider not here shows by its id. */
	providers: ReadonlyMap<string, string>;
	/** Opens the Creds page, where a worker's keys are added. */
	onOpenKeys: () => void;
}

/**
 * One worker's card: its name, state and health on the header's left, its
 * actions on the right, as the Budget page lays a role out; then what
 * `splates worker list` says of it, and its slots, set in the footer.
 */
export function WorkerShell({
	label,
	title,
	line,
	badges,
	actions,
	worker,
	updating,
	frame,
	onSlots,
	refusal,
}: {
	label: string;
	title: ReactNode;
	/** Under the title: what it is, and how it stands. */
	line: string;
	badges?: ReactNode;
	actions: ReactNode;
	/** Its listing, or null for a worker that is not in the pool. */
	worker: WorkerListing | null;
	updating: boolean;
	frame: WorkerCardFrame;
	onSlots: (slots: number) => void;
	refusal: string | undefined;
}): JSX.Element {
	return (
		<li
			aria-label={label}
			className="overflow-hidden rounded-xl border bg-card shadow-xs"
		>
			<header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="flex flex-wrap items-center gap-2">
						{title}
						{badges}
					</span>
					<span className="text-muted-foreground text-xs">{line}</span>
				</div>
				<div className="ml-auto flex items-center gap-1">{actions}</div>
			</header>
			{worker !== null && (
				<>
					<Facts worker={worker} updating={updating} frame={frame} />
					<footer className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-2">
						<SlotsField worker={worker} onSet={onSlots} />
					</footer>
				</>
			)}
			<Refusal refusal={refusal} className="px-4 pb-2" />
		</li>
	);
}

/** A worker's id, as the CLI names it. */
export function WorkerName({ id }: { id: string }): JSX.Element {
	return <code className="font-medium font-mono text-[13px]">{id}</code>;
}

/** How a worker is: up or away, and draining or being removed. */
export function Health({ worker }: { worker: WorkerListing }): JSX.Element {
	return (
		<span className="flex flex-wrap items-center gap-1">
			<Badge variant={worker.health === "connected" ? "secondary" : "outline"}>
				{worker.health}
			</Badge>
			{worker.removing ? (
				<Badge variant="destructive">removing</Badge>
			) : (
				worker.draining && <Badge variant="outline">draining</Badge>
			)}
		</span>
	);
}

/** What `splates worker list` says of a worker, a fact per column. */
function Facts({
	worker,
	updating,
	frame,
}: {
	worker: WorkerListing;
	updating: boolean;
	frame: WorkerCardFrame;
}): JSX.Element {
	const local = worker.kind === "local";
	return (
		<dl className="grid grid-cols-2 gap-3 border-t px-4 py-3 sm:grid-cols-3 lg:grid-cols-5">
			<Fact name="platform">
				{worker.platform === null ? (
					<Quiet>unknown</Quiet>
				) : (
					<>
						{worker.platform}
						{worker.host !== null && ` (${worker.host})`}
					</>
				)}
			</Fact>
			<Fact name="build">
				{worker.build ?? <Quiet>unknown</Quiet>}
				{updating && (
					<span className="text-muted-foreground text-xs">
						{" "}
						· update waiting
					</span>
				)}
			</Fact>
			<Fact name="cost">
				{worker.dollarsPerHour === 0 ? (
					<Quiet>none</Quiet>
				) : (
					`$${worker.dollarsPerHour.toFixed(2)}/hour`
				)}
			</Fact>
			<Fact name="keys">
				{local ? (
					"signs in as you"
				) : worker.keys.length === 0 ? (
					<button
						type="button"
						className="text-muted-foreground underline-offset-2 hover:underline"
						onClick={frame.onOpenKeys}
					>
						none: add one
					</button>
				) : (
					worker.keys.map((id) => frame.providers.get(id) ?? id).join(", ")
				)}
			</Fact>
			<Fact name="tasks">
				{worker.tasks.length === 0 ? (
					<Quiet>none</Quiet>
				) : (
					worker.tasks.map((task, at) => (
						<span key={task}>
							{at > 0 && ", "}
							{frame.tasks.has(task) ? (
								<button
									type="button"
									className="underline-offset-2 hover:underline"
									onClick={() => frame.onOpenTask(task)}
								>
									{task}
								</button>
							) : (
								task
							)}
						</span>
					))
				)}
			</Fact>
		</dl>
	);
}

/** A fact with nothing to say, quietly: not known, or none. */
function Quiet({ children }: { children: string }): JSX.Element {
	return <span className="text-muted-foreground">{children}</span>;
}

/** One fact of a worker, its name over it. */
function Fact({
	name,
	children,
}: {
	name: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<div className="flex min-w-0 flex-col">
			<dt className="text-muted-foreground text-xs">{name}</dt>
			<dd className="truncate text-sm">{children}</dd>
		</div>
	);
}

/**
 * How many agents `worker` runs at once, a way to change it, and how many
 * of those slots are in use now.
 */
export function SlotsField({
	worker,
	onSet,
}: {
	worker: WorkerListing;
	onSet: (slots: number) => void;
}): JSX.Element {
	const shown = worker.slots.total === null ? "" : String(worker.slots.total);
	const [typed, setTyped] = useState<string | null>(null);
	const value = typed ?? shown;
	const slots = Number(value);
	const valid = Number.isInteger(slots) && slots >= 1;
	const { used } = worker.slots;
	return (
		<form
			aria-label={`${worker.id} slots`}
			className="flex flex-wrap items-center gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				if (valid) {
					onSet(slots);
					setTyped(null);
				}
			}}
		>
			<label
				htmlFor={`${worker.id}-slots`}
				className="text-muted-foreground text-xs"
			>
				Slots
			</label>
			<Input
				id={`${worker.id}-slots`}
				type="number"
				min={1}
				inputMode="numeric"
				aria-label="slots"
				className="h-7 w-20"
				value={value}
				placeholder="any"
				onChange={(event) => setTyped(event.target.value)}
			/>
			{typed !== null && typed !== shown ? (
				<Button type="submit" size="sm" disabled={!valid}>
					Set
				</Button>
			) : (
				<span className="text-muted-foreground text-xs">
					{used === 0 ? "none in use" : `${used} in use`}
				</span>
			)}
		</form>
	);
}
