import type {
	WorkerListing,
	WorkerPool,
} from "@stringsync/splates-server/workers";
import { useDisposerEffect, useReactive } from "@webappwiz/react";
import type { JSX, ReactNode } from "react";
import { Switch } from "#web/components/ui/switch.tsx";
import { cn } from "#web/lib/utils.ts";
import { ReadingNow } from "./countdown";
import { localWorker, localWorkerOn } from "./local-worker";
import { useReading } from "./page-readings";
import { PHONE_HEADING } from "./phone-rows";
import { useRefusals } from "./refusal";
import { TopBar } from "./top-bar";
import {
	Health,
	WorkerCard,
	type WorkerCardFrame,
	WorkerName,
	WorkerShell,
} from "./worker-card";
import { behind, WorkerPoolView } from "./worker-pool";

/**
 * The Workers page: this Mac as a worker, which it turns on and off, the
 * pool as `splates worker list` shows it, with the same actions as the CLI,
 * and the workers waiting on an update.
 */
export function WorkersPage({
	tasks,
	onOpenTask,
}: {
	/** The tasks of this project, which a worker's tasks open on the Tasks page. */
	tasks: ReadonlySet<string>;
	onOpenTask: (name: string) => void;
}): JSX.Element {
	const view = useReading("workers", () => new WorkerPoolView());
	useDisposerEffect((disposer) => disposer.use(view.watch()), [view]);
	const { pool, error } = useReactive(
		view,
		({ pool, error }) => ({ pool, error }),
		["changed"],
	);
	const { refusals, refuse } = useRefusals<string>();
	// Each change says why it was refused on the worker it was for.
	const attempt = (id: string, title: string, write: Promise<void>) =>
		void write.catch((caught) => refuse(id, title, caught));
	const setSlots = (id: string, slots: number) =>
		attempt(id, "Slots not changed", view.change(id, { slots }));
	const frame: WorkerCardFrame = { tasks, onOpenTask };
	return (
		<section aria-label="workers" className="flex min-w-0 flex-col gap-8">
			<TopBar title="Workers" />
			{error !== null && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
			{pool === null && error === null && (
				<ReadingNow label="Reading workers…" />
			)}
			{pool !== null && (
				<>
					<Updates pool={pool} />
					<div className="flex flex-col gap-3">
						<Heading title="Pool">
							This Mac, which runs the agents, then each worker that joined.
						</Heading>
						<ul aria-label="pool" className="flex flex-col gap-4">
							<ThisMac
								pool={pool}
								frame={frame}
								refusal={refusals.get("local")}
								onTurn={(on) =>
									attempt(
										"local",
										on ? "Not turned on" : "Not turned off",
										view.turnLocal(on),
									)
								}
								onSlots={setSlots}
							/>
							{pool.workers
								.filter((worker) => worker.kind !== "local")
								.map((worker) => (
									<WorkerCard
										key={worker.id}
										worker={worker}
										updating={behind(pool).includes(worker)}
										frame={frame}
										refusal={refusals.get(worker.id)}
										onDrain={(draining) =>
											attempt(
												worker.id,
												draining ? "Not drained" : "Not resumed",
												view.change(worker.id, { draining }),
											)
										}
										onSlots={(slots) => setSlots(worker.id, slots)}
										onRemove={(force) =>
											attempt(
												worker.id,
												"Not removed",
												view.remove(worker, force),
											)
										}
									/>
								))}
						</ul>
						<TurnedAway pool={pool} />
					</div>
				</>
			)}
		</section>
	);
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
	const running =
		used === 0
			? "none run"
			: used === 1
				? "1 agent runs"
				: `${used} agents run`;
	if (on) {
		return total === null
			? `Takes new agents; ${running} here now.`
			: `Takes new agents, up to ${total} at once; ${running} here now.`;
	}
	return used > 0
		? `Off: takes no new agents, and the ${used === 1 ? "one" : used} here run${used === 1 ? "s" : ""} to ${used === 1 ? "its" : "their"} end.`
		: "Off: takes no new agents.";
}

/**
 * This Mac as a worker, first in the pool: a switch that turns it on and
 * off where another worker has its actions, and its listing while it is
 * one.
 */
function ThisMac({
	pool,
	frame,
	refusal,
	onTurn,
	onSlots,
}: {
	pool: WorkerPool;
	frame: WorkerCardFrame;
	refusal: string | undefined;
	onTurn: (on: boolean) => void;
	onSlots: (id: string, slots: number) => void;
}): JSX.Element {
	const local = localWorker(pool);
	const on = localWorkerOn(pool);
	return (
		<WorkerShell
			label="worker local"
			title={
				local === null ? (
					<span className="font-medium text-sm">This Mac</span>
				) : (
					<>
						<WorkerName id={local.id} />
						<span className="text-muted-foreground text-xs">this Mac</span>
					</>
				)
			}
			line={localState(local, on)}
			badges={local === null ? undefined : <Health worker={local} />}
			worker={local}
			updating={local !== null && behind(pool).includes(local)}
			frame={frame}
			onSlots={(slots) => local !== null && onSlots(local.id, slots)}
			refusal={refusal}
			actions={
				<span className="flex items-center gap-2 text-sm">
					<span id="runs-agents">Runs agents</span>
					<Switch
						aria-labelledby="runs-agents"
						checked={on}
						onCheckedChange={(checked) => onTurn(checked)}
					/>
				</span>
			}
		/>
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

/** The machines that asked to join and were refused, each with why. */
function TurnedAway({ pool }: { pool: WorkerPool }): JSX.Element | null {
	if (pool.refused.length === 0) {
		return null;
	}
	return (
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
	);
}
