import type { WorkerListing } from "@stringsync/splates-server/workers";
import { type JSX, type ReactNode, useState } from "react";
import { Badge } from "#web/components/ui/badge.tsx";
import { Button } from "#web/components/ui/button.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { useMinute } from "./hooks/use-minute";
import { ago } from "./plan-limits";
import { Refusal } from "./refusal";

/** One worker: what `splates worker list` says of it, and its actions. */
export function WorkerCard({
	worker,
	updating,
	tasks,
	onOpenTask,
	providers,
	onOpenKeys,
	refusal,
	onDrain,
	onSlots,
	onRemove,
}: {
	worker: WorkerListing;
	updating: boolean;
	tasks: ReadonlySet<string>;
	onOpenTask: (name: string) => void;
	/** The names of the key providers, by id; a provider not here shows by its id. */
	providers: ReadonlyMap<string, string>;
	/** Opens the Creds page, where a worker's keys are added. */
	onOpenKeys: () => void;
	refusal: string | undefined;
	onDrain: (draining: boolean) => void;
	onSlots: (slots: number) => void;
	onRemove: (force: boolean) => void;
}): JSX.Element {
	const local = worker.kind === "local";
	const { used } = worker.slots;
	return (
		<li
			aria-label={`worker ${worker.id}`}
			className="overflow-hidden rounded-xl border bg-card shadow-xs"
		>
			<header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3">
				<span className="flex min-w-0 flex-1 items-baseline gap-2">
					<code className="font-medium font-mono text-[13px]">{worker.id}</code>
					<span className="text-muted-foreground text-xs">
						{local ? "this Mac" : worker.kind}
					</span>
				</span>
				<Health worker={worker} />
			</header>
			<dl className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
				<Fact name="platform">
					{worker.platform ?? "?"}
					{worker.host !== null && ` (${worker.host})`}
				</Fact>
				<Fact name="slots">
					{used}/{worker.slots.total ?? "?"}
				</Fact>
				<Fact name="build">
					{worker.build ?? "?"}
					{updating && (
						<span className="text-muted-foreground text-xs">
							{" "}
							· update waiting
						</span>
					)}
				</Fact>
				<Fact name="$/hour">{worker.dollarsPerHour.toFixed(2)}</Fact>
				<Fact name="keys">
					{local ? (
						"signs in as you"
					) : worker.keys.length === 0 ? (
						<button
							type="button"
							className="text-muted-foreground underline-offset-2 hover:underline"
							onClick={onOpenKeys}
						>
							none: add one
						</button>
					) : (
						worker.keys.map((id) => providers.get(id) ?? id).join(", ")
					)}
				</Fact>
				<Fact name="tasks">
					{worker.tasks.length === 0
						? "-"
						: worker.tasks.map((task, at) => (
								<span key={task}>
									{at > 0 && ", "}
									{tasks.has(task) ? (
										<button
											type="button"
											className="underline-offset-2 hover:underline"
											onClick={() => onOpenTask(task)}
										>
											{task}
										</button>
									) : (
										task
									)}
								</span>
							))}
				</Fact>
			</dl>
			{!local && (
				<footer className="flex flex-wrap items-center gap-2 border-t px-4 py-2">
					<SlotsField worker={worker} onSet={onSlots} />
					<span className="flex-1" />
					{!worker.removing && (
						<Button
							variant="outline"
							size="sm"
							onClick={() => onDrain(!worker.draining)}
						>
							{worker.draining ? "Resume" : "Drain"}
						</Button>
					)}
					{worker.removing ? (
						<Button
							variant="destructive"
							size="sm"
							title={`Ends the ${used} running on it now`}
							onClick={() => onRemove(true)}
						>
							Remove now
						</Button>
					) : (
						<Button
							variant="outline"
							size="sm"
							title={
								used > 0
									? "Drains it, and removes it once what runs on it ends"
									: "Revokes its key and forgets it"
							}
							onClick={() => onRemove(false)}
						>
							Remove
						</Button>
					)}
				</footer>
			)}
			<Refusal refusal={refusal} className="px-4 pb-2" />
		</li>
	);
}

/** How a worker is: up or away, and draining or being removed. */
function Health({ worker }: { worker: WorkerListing }): JSX.Element {
	const now = useMinute();
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
			{worker.lastHeard !== null && (
				<span className="text-muted-foreground text-xs">
					heard {ago(worker.lastHeard, now)}
				</span>
			)}
		</span>
	);
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

/** How many agents `worker` runs at once, and a way to change it. */
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
	return (
		<form
			aria-label={`${worker.id} slots`}
			className="flex items-center gap-2"
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
				placeholder="?"
				onChange={(event) => setTyped(event.target.value)}
			/>
			{typed !== null && typed !== shown && (
				<Button type="submit" size="sm" disabled={!valid}>
					Set
				</Button>
			)}
		</form>
	);
}
