import type {
	WorkerListing,
	WorkerPool,
} from "@stringsync/splates-server/workers";
import { useDisposerEffect, useReactive } from "@webappwiz/react";
import { type JSX, type ReactNode, useEffect, useState } from "react";
import { Switch } from "#web/components/ui/switch.tsx";
import { cn } from "#web/lib/utils.ts";
import { workerKeys } from "./api";
import { localWorker, localWorkerOn } from "./local-worker";
import { PHONE_HEADING } from "./phone-rows";
import { Refusal, useRefusals } from "./refusal";
import { TopBar } from "./top-bar";
import { SlotsField, WorkerCard } from "./worker-card";
import { JoinToken } from "./worker-invite";
import { behind, WorkerPoolView } from "./worker-pool";

/**
 * The Workers page: this Mac as a worker, which it turns on and off, the
 * pool as `splates worker list` shows it, with the same actions as the CLI,
 * the workers waiting on an update, and a join token for another.
 */
export function WorkersPage({
	tasks,
	onOpenTask,
	onOpenKeys,
}: {
	/** The tasks of this project, which a worker's tasks open on the Tasks page. */
	tasks: ReadonlySet<string>;
	onOpenTask: (name: string) => void;
	/** Opens the Creds page, where a worker's keys are added. */
	onOpenKeys: () => void;
}): JSX.Element {
	const [view] = useState(() => new WorkerPoolView());
	useDisposerEffect((disposer) => disposer.use(view.watch()), [view]);
	const { pool, error } = useReactive(
		view,
		({ pool, error }) => ({ pool, error }),
		["changed"],
	);
	const providers = useProviderNames();
	const { refusals, refuse } = useRefusals<string>();
	// Each change says why it was refused on the worker it was for.
	const attempt = (id: string, title: string, write: Promise<void>) =>
		void write.catch((caught) => refuse(id, title, caught));
	const slots = (id: string, slots: number) =>
		attempt(id, "Slots not changed", view.change(id, { slots }));
	return (
		<section aria-label="workers" className="flex min-w-0 flex-col gap-8">
			<TopBar title="Workers" />
			{error !== null && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
			{pool === null && error === null && (
				<p role="status" className="text-muted-foreground text-sm">
					Reading workers…
				</p>
			)}
			{pool !== null && (
				<>
					<ThisMac
						pool={pool}
						refusal={refusals.get("this mac")}
						onTurn={(on) =>
							attempt(
								"this mac",
								on ? "Not turned on" : "Not turned off",
								view.turnLocal(on),
							)
						}
						onSlots={slots}
					/>
					<Updates pool={pool} />
					<Pool
						pool={pool}
						tasks={tasks}
						onOpenTask={onOpenTask}
						providers={providers}
						onOpenKeys={onOpenKeys}
						refusals={refusals}
						onDrain={(id, draining) =>
							attempt(
								id,
								draining ? "Not drained" : "Not resumed",
								view.change(id, { draining }),
							)
						}
						onWake={(id) => attempt(id, "Not woken", view.wake(id))}
						onSlots={slots}
						onRemove={(worker, force) =>
							attempt(worker.id, "Not removed", view.remove(worker, force))
						}
					/>
					<div className="flex flex-col gap-3">
						<Heading title="Add a worker">
							A join token, single use and good for 15 minutes.
						</Heading>
						<JoinToken build={pool.build} />
					</div>
				</>
			)}
		</section>
	);
}

/** The names of the key providers by id, read once; empty until read, or if it cannot be. */
function useProviderNames(): ReadonlyMap<string, string> {
	const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
	useEffect(() => {
		workerKeys()
			.then((read) =>
				setNames(new Map(read.providers.map((each) => [each.id, each.name]))),
			)
			.catch(() => {});
	}, []);
	return names;
}

/** A section's heading, with a line on what it holds. */
function Heading({
	title,
	children,
}: {
	title: string;
	children?: ReactNode;
}): JSX.Element {
	return (
		<header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
			<h2 className={cn("font-medium text-sm", PHONE_HEADING)}>{title}</h2>
			{children !== undefined && (
				<span className="text-muted-foreground text-xs">{children}</span>
			)}
		</header>
	);
}

/** What this Mac does as a worker, in a sentence. */
function localState(local: WorkerListing | null, on: boolean): string {
	if (local === null) {
		return "This Mac runs no agents: it only coordinates the workers below.";
	}
	if (local.updating) {
		return "Updating: temporarily takes no new agents; resumes when the update finishes.";
	}
	const { used, total } = local.slots;
	const running = used === 1 ? "1 agent runs" : `${used} agents run`;
	if (on) {
		return total === null
			? `Takes new agents; ${running} here now.`
			: `Takes new agents, up to ${total} at once; ${running} here now.`;
	}
	return used > 0
		? `Off: takes no new agents, and the ${used === 1 ? "one" : used} here run${used === 1 ? "s" : ""} to ${used === 1 ? "its" : "their"} end.`
		: "Off: takes no new agents.";
}

/** This Mac as a worker: on or off, and how many agents it runs at once. */
function ThisMac({
	pool,
	refusal,
	onTurn,
	onSlots,
}: {
	pool: WorkerPool;
	refusal: string | undefined;
	onTurn: (on: boolean) => void;
	onSlots: (id: string, slots: number) => void;
}): JSX.Element {
	const local = localWorker(pool);
	const on = localWorkerOn(pool);
	return (
		<div className="flex flex-col gap-3">
			<Heading title="This Mac">
				Runs agents, yours and those other agents start, beside any other
				worker.
			</Heading>
			<section
				aria-label="this mac"
				className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3 shadow-xs"
			>
				<div className="flex items-center gap-3">
					<Switch
						aria-label="Runs agents"
						checked={on}
						onCheckedChange={(checked) => onTurn(checked)}
					/>
					<span className="flex min-w-0 flex-col">
						<span className="font-medium text-sm">
							{on ? "A worker" : "Not a worker"}
						</span>
						<span className="text-muted-foreground text-xs">
							{localState(local, on)}
						</span>
					</span>
				</div>
				{local !== null && (
					<SlotsField
						worker={local}
						onSet={(slots) => onSlots(local.id, slots)}
					/>
				)}
				<Refusal refusal={refusal} />
			</section>
		</div>
	);
}

/**
 * The workers on another build than this server's, while any is, and where
 * the rollout bringing them to it stands with each.
 */
function Updates({ pool }: { pool: WorkerPool }): JSX.Element | null {
	const waiting = behind(pool);
	if (waiting.length === 0) {
		return null;
	}
	const known = pool.workers.filter((worker) => worker.build !== null);
	return (
		<div className="flex flex-col gap-3">
			<Heading title="Waiting on an update">
				This server runs {pool.build}, and {known.length - waiting.length} of{" "}
				{known.length} workers do. They update one at a time.
			</Heading>
			<ul aria-label="waiting on an update" className="flex flex-col gap-1">
				{waiting.map((worker) => (
					<li key={worker.id} className="text-sm">
						<code className="font-mono text-[13px]">{worker.id}</code>{" "}
						<span className="text-muted-foreground">
							runs {worker.build}
							{rolloutState(pool, worker)}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

/** Where `worker` stands in `pool`'s rollout, as its line on the page ends. */
function rolloutState(pool: WorkerPool, worker: WorkerListing): string {
	const { updating, next, byHand } = pool.rollout;
	if (updating?.id === worker.id) {
		return updating.stage === "moving"
			? `, moving ${updating.agents === 1 ? "its agent" : `its ${updating.agents} agents`} off it`
			: ", updating now";
	}
	if (next[0] === worker.id) {
		return ", next";
	}
	if (next.includes(worker.id)) {
		return ", waiting its turn";
	}
	if (byHand.includes(worker.id)) {
		return ", update it by hand";
	}
	return worker.slots.used > 0 ? `, with ${worker.slots.used} running` : "";
}

/** Every worker, with what can be done to each, and those turned away. */
function Pool({
	pool,
	tasks,
	onOpenTask,
	providers,
	onOpenKeys,
	refusals,
	onDrain,
	onWake,
	onSlots,
	onRemove,
}: {
	pool: WorkerPool;
	tasks: ReadonlySet<string>;
	onOpenTask: (name: string) => void;
	providers: ReadonlyMap<string, string>;
	onOpenKeys: () => void;
	refusals: ReadonlyMap<string, string>;
	onDrain: (id: string, draining: boolean) => void;
	onWake: (id: string) => void;
	onSlots: (id: string, slots: number) => void;
	onRemove: (worker: WorkerListing, force: boolean) => void;
}): JSX.Element {
	return (
		<div className="flex flex-col gap-3">
			<Heading title="Pool">Every worker agents run on.</Heading>
			<ul aria-label="pool" className="flex flex-col gap-4">
				{pool.workers.map((worker) => (
					<WorkerCard
						key={worker.id}
						worker={worker}
						updating={behind(pool).includes(worker)}
						tasks={tasks}
						onOpenTask={onOpenTask}
						providers={providers}
						onOpenKeys={onOpenKeys}
						refusal={refusals.get(worker.id)}
						onDrain={(draining) => onDrain(worker.id, draining)}
						onWake={() => onWake(worker.id)}
						onSlots={(slots) => onSlots(worker.id, slots)}
						onRemove={(force) => onRemove(worker, force)}
					/>
				))}
			</ul>
			{pool.refused.length > 0 && (
				<ul aria-label="turned away" className="flex flex-col gap-1">
					{pool.refused.map((refused) => (
						<li
							key={`${refused.id} ${refused.protocol}`}
							className="text-muted-foreground text-xs"
						>
							Turned away <code className="font-mono">{refused.id}</code> (
							{refused.protocol}): {refused.reason}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
