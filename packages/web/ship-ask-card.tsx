import type { PermissionProposal } from "@splates/server/plans";
import {
	SHIP_DECLINED,
	shipStartedIn,
	shipStartedReference,
} from "@splates/server/plans/browser";
import type { RunState } from "@splates/server/ship";
import { useDisposerEffect, useReactive } from "core/react";
import { BanIcon, CheckIcon, ShipIcon } from "lucide-react";
import { type JSX, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { startShip } from "./api/ship";
import { CardBox, useCardDictationTurn } from "./card-box";
import { useCardReply, useKept } from "./card-reply";
import { CardSection } from "./card-section";
import { CardBody, CardShell } from "./card-shell";
import { useEnterDoes } from "./enter-while-taking";
import { cn } from "./lib/utils";
import { spanOf } from "./merge-lines";
import { shipRunAddress, todoAddress } from "./page-address";
import { PendingSpinner, useShowPending } from "./pending";
import { Refusal, useRefusal } from "./refusal";
import { type ShipRunServer, ShipRunView } from "./ship-run";
import { summarize, type TargetSummary } from "./ship-run-summary";
import { SHIP_RUN_SERVER } from "./ship-run-view";
import { SplatesEvent } from "./splates-event";

/**
 * Render for a `ship` permission: the targets an agent asks you to ship, each
 * with its bump, and why. Approve starts the ship and tells the agent its
 * run and opens its active ship page, and the card follows that run to done; Decline tells the agent
 * no. Approve is the only way an agent's ask becomes a ship.
 */
export function ShipAskCard({
	proposal,
	server = SHIP_RUN_SERVER,
	start = startShip,
	open = openRun,
}: {
	proposal: PermissionProposal;
	server?: ShipRunServer;
	start?: typeof startShip;
	/** Shows run `id` on the Ships page, as Approve does once the agent is told. */
	open?: (id: string) => void;
}): JSX.Element {
	const { reply, sent } = useCardReply();
	const { refusal, attempt } = useRefusal();
	const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
	const showBusy = useShowPending(busy !== null);
	// The run Approve started, before the thread shows the reply naming it.
	const [started, setStarted] = useState<string | null>(null);
	const [opened, setOpened] = useState(false);
	const picks = proposal.ship?.picks ?? [];
	const run = (sent === null ? null : shipStartedIn(sent)) ?? started;
	const declined = sent?.includes(SHIP_DECLINED) === true;
	const send = reply?.send ?? null;
	const kept = useKept(
		`ship:${picks.map((pick) => pick.name).join(",")}`,
		sent,
	);
	const [more, setMore] = useState(kept.read);
	const written = useRef(more);
	const panel = useRef<HTMLDivElement>(null);
	const turn = useCardDictationTurn(panel);
	const noteHead = "\n\n> **Anything else?**\n\n";
	const withNote = (text: string): string => {
		const note = written.current.trim();
		return note === "" ? text : `${text}${noteHead}${note}`;
	};
	const enterDoes = useEnterDoes(
		panel,
		send === null || busy !== null || picks.length === 0
			? null
			: () => turn(approve),
	);
	const count = `${picks.length} ${picks.length === 1 ? "target" : "targets"}`;
	if (run !== null) {
		return <ShipRunCard id={run} count={count} server={server} />;
	}
	if (declined && !opened) {
		return (
			<SplatesEvent
				event={{
					mark: "failed",
					words: [`Declined shipping ${count}`],
					title: SHIP_DECLINED,
					act: { label: "Open", run: () => setOpened(true) },
				}}
			/>
		);
	}
	const approve = (): void => {
		if (send === null) {
			return;
		}
		setBusy("approve");
		void attempt(
			start(picks)
				.then(async (state) => {
					setStarted(state.id);
					await send(withNote(shipStartedReference(state.id)));
					open(state.id);
				})
				.finally(() => setBusy(null)),
			"Not shipped",
		);
	};
	const decline = (): void => {
		if (send === null) {
			return;
		}
		setBusy("decline");
		void attempt(
			send(withNote(SHIP_DECLINED)).finally(() => setBusy(null)),
			"Not declined",
		);
	};
	return (
		<CardShell
			label="ship"
			Icon={ShipIcon}
			title={proposal.title ?? `Ship ${count}`}
			tone="ship"
		>
			<div className="mx-4 mt-3 mb-2 flex flex-col">
				<p className="pb-1.5 font-semibold text-sm">Ship {count}?</p>
				{picks.map((pick) => (
					<Row
						key={pick.name}
						name={pick.name}
						aside={pick.bump ?? "its own bump"}
					/>
				))}
			</div>
			{proposal.body !== "" && <CardBody text={proposal.body} />}
			{!declined && send !== null && (
				<div ref={panel} className="border-t px-4 py-4">
					<CardSection
						label="Anything else section"
						title="Anything else?"
						ruled={false}
					>
						<CardBox
							aria-label="Anything else"
							value={more}
							placeholder="Your answer (optional)"
							files={null}
							onKeyDown={enterDoes}
							onValue={(text) => {
								written.current = text;
								setMore(text);
								kept.write(text);
							}}
						/>
					</CardSection>
				</div>
			)}
			<div className="flex flex-wrap items-center justify-end gap-2 border-border/60 border-t px-4 py-2.5">
				{declined ? (
					<span className="flex items-center gap-1 text-xs">
						<BanIcon className="size-3.5" />
						Declined
					</span>
				) : (
					<>
						<Button
							size="sm"
							variant="outline"
							disabled={send === null || busy !== null}
							onClick={() => turn(decline)}
							className="gap-1.5 in-data-sheet:h-11 in-data-sheet:text-base"
						>
							{busy === "decline" && showBusy ? (
								<PendingSpinner shown />
							) : (
								<BanIcon data-icon="inline-start" />
							)}
							Decline
						</Button>
						<Button
							size="sm"
							disabled={send === null || busy !== null || picks.length === 0}
							onClick={() => turn(approve)}
							className="gap-1.5 in-data-sheet:h-11 in-data-sheet:flex-1 in-data-sheet:text-base"
						>
							{busy === "approve" && showBusy ? (
								<PendingSpinner shown />
							) : (
								<CheckIcon data-icon="inline-start" />
							)}
							Approve
						</Button>
					</>
				)}
			</div>
			<Refusal refusal={refusal} />
		</CardShell>
	);
}

/** Opens run `id`'s active ship page, the way the Ships page does on Approve. */
function openRun(id: string): void {
	location.hash = shipRunAddress(id);
}

/** A target's line: its name, and on the right where it stands. */
function Row({
	name,
	aside,
	className,
}: {
	name: string;
	aside: string;
	className?: string;
}): JSX.Element {
	return (
		<div className="flex items-baseline gap-3 border-border/60 border-b border-dashed py-1 text-sm last:border-b-0">
			<span className="min-w-0 flex-1 truncate">{name}</span>
			<span className={cn("shrink-0 text-right", className)}>{aside}</span>
		</div>
	);
}

/** The ship card once Approve started run `id`: the run as it goes, live. */
function ShipRunCard({
	id,
	count,
	server,
}: {
	id: string;
	count: string;
	server: ShipRunServer;
}): JSX.Element {
	const [view] = useState(() => new ShipRunView(id, server));
	useDisposerEffect((disposer) => disposer.use(view.attach()), [view]);
	const { run, missing } = useReactive(view, (view) => view.state, ["changed"]);
	const open = (
		<a href={shipRunAddress(id)} className="underline underline-offset-2">
			Open run
		</a>
	);
	if (run === null) {
		return (
			<CardShell
				label="ship"
				Icon={ShipIcon}
				title={`Shipping ${count}`}
				tone="ship"
			>
				<p className="mx-4 my-3 text-muted-foreground text-sm">
					{missing ? `No ship run is "${id}".` : "Reading the run…"} {open}
				</p>
			</CardShell>
		);
	}
	const summary = summarize(run);
	const targets = summary.steps.flat();
	const word = targets.length === 1 ? "target" : "targets";
	const title =
		run.status === "done"
			? `Shipped ${targets.length} ${word}`
			: `Shipping ${targets.length} ${word}`;
	const failed = targets.find((each) => each.status === "failed");
	const failedStep = failed?.failed[0];
	const fixing = failed?.fixes.find(
		(fix) => fix.step === failedStep?.id && fix.ended === undefined,
	);
	const fixed = targets.flatMap((target) =>
		target.fixes.filter((fix) => fix.ended === "merged"),
	);
	return (
		<CardShell
			label="ship"
			Icon={ShipIcon}
			title={title}
			tone={
				run.status === "done"
					? "success"
					: run.status === "failed"
						? "destructive"
						: "ship"
			}
			aside={
				<span className="rounded-full border px-2 py-0.5 text-xs">
					{run.status === "done"
						? "done"
						: run.status === "failed"
							? "failed"
							: "running"}
				</span>
			}
		>
			<div className="mx-4 mt-3 mb-2 flex flex-col">
				{targets.map((target) => (
					<Row
						key={target.name}
						name={nameOf(run, target)}
						aside={asideOf(run, target)}
						className={cn(
							target.status === "failed" && "text-destructive",
							target.status === "waiting" && "text-muted-foreground",
						)}
					/>
				))}
			</div>
			{run.status === "running" && (
				<div
					role="progressbar"
					aria-label="Targets done"
					aria-valuemin={0}
					aria-valuemax={summary.total}
					aria-valuenow={summary.done}
					className="mx-4 mb-2 h-1.5 overflow-hidden rounded-full bg-muted"
				>
					<div
						className="h-full rounded-full bg-foreground"
						style={{
							width: `${summary.total === 0 ? 0 : (summary.done / summary.total) * 100}%`,
						}}
					/>
				</div>
			)}
			{failed !== undefined && failedStep !== undefined && (
				<div className="mx-4 mb-2 rounded border border-dashed px-3 py-2 text-sm">
					<p className="font-medium">
						{failed.name}: {failedStep.does} failed
					</p>
					<p className="break-words text-muted-foreground text-xs">
						{failed.line}
					</p>
					{fixing !== undefined && (
						<p className="pt-1 text-muted-foreground text-xs">
							→ An agent is fixing it in{" "}
							<a
								className="underline underline-offset-2"
								href={todoAddress(fixing.task)}
							>
								#{fixing.task}
							</a>
							; the ship retries it once the fix merges
						</p>
					)}
				</div>
			)}
			<p className="mx-4 mb-3 text-muted-foreground text-xs tabular-nums">
				{footOf(run)}
				{fixed.map((fix) => (
					<span key={`${fix.step}\n${fix.task}`}>
						{" "}
						· fix:{" "}
						<a
							className="underline underline-offset-2"
							href={todoAddress(fix.task)}
						>
							#{fix.task}
						</a>
					</span>
				))}{" "}
				· {open}
			</p>
		</CardShell>
	);
}

/** A target's name, with the version it released once it has. */
function nameOf(run: RunState, target: TargetSummary): string {
	const released = run.targets.find(
		(each) => each.name === target.name,
	)?.released;
	return released === undefined ? target.name : `${target.name} ${released}`;
}

/** Where a target stands, as its line's right side says. */
function asideOf(run: RunState, target: TargetSummary): string {
	if (target.status === "done") {
		return "✓ shipped";
	}
	if (target.status === "failed") {
		return `✕ ${target.failed[0]?.id ?? "failed"}`;
	}
	if (target.status === "waiting") {
		const state = run.targets.find((each) => each.name === target.name);
		const upstream = state?.dependencies.filter((name) =>
			run.targets.some(
				(each) =>
					each.name === name &&
					!each.steps.every((step) =>
						["done", "skipped"].includes(step.status),
					),
			),
		);
		return upstream !== undefined && upstream.length > 0
			? `waits on ${upstream.join(", ")}`
			: target.line;
	}
	return target.asking ? "waiting on you" : target.line;
}

/** The card's last line: when the user approved it, or how long it took. */
function footOf(run: RunState): string {
	const at = new Date(run.started).toLocaleTimeString([], {
		hour: "numeric",
		minute: "2-digit",
	});
	if (run.status === "running") {
		return `Approved by you · ${at}`;
	}
	const ended = Math.max(
		run.started,
		...run.targets.flatMap((target) =>
			target.steps.flatMap((step) => step.ended ?? []),
		),
	);
	const retries = run.targets
		.flatMap((target) => target.steps)
		.reduce((sum, step) => sum + (step.retries ?? 0), 0);
	return [
		`Approved by you · ${at}`,
		spanOf(ended - run.started),
		...(retries === 0
			? []
			: [retries === 1 ? "retried once" : `retried ${retries} times`]),
	].join(" · ");
}
