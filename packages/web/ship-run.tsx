import type { Cascade, Ship, StageKey } from "@splates/server/ship";
import { shipName } from "@splates/server/ship/browser";
import { RotateCcwIcon, SquareIcon } from "lucide-react";
import { type JSX, type ReactNode, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { cn } from "./lib/utils";
import { askMachineNow } from "./machine";
import { Refusal, useRefusals } from "./refusal";
import { type Attention, attentionOf } from "./ship-dock";
import {
	AskCard,
	askedSlug,
	ChipFor,
	HELD,
	JobTime,
	jobState,
	statusLabel,
} from "./ship-job-status";
import { ProjectStage } from "./ship-project-stages";
import { ShipRecap } from "./ship-recap";
import type { SlowStage } from "./ship-slow-bar";
import { ICONS } from "./ship-stages";

export { ProjectStages } from "./ship-project-stages";
/**
 * A ship under way, or one that stopped: a stage per project in the order
 * they go, every step of each checked off as it ends, and what waits on the
 * person, or why it stopped, in the dock beneath them. Stop puts away a run
 * that ended, and abandons one still going after asking.
 */
export function ShipRun({
	cascade,
	ship,
	onClose,
	abandon: abandonRun,
	retry,
	agent,
	sendToAgent,
	sendSlowToAgent,
}: {
	cascade: Cascade;
	ship: Ship | null;
	/** Starts a conversation with an agent about a stage that runs past its expected time; the ship carries on. */
	sendSlowToAgent?: (slow: SlowStage) => Promise<void>;
	/** Ends the run; the cascade alone by default, the run and its conversation when it has one. */
	abandon?: () => Promise<void>;
	retry?: () => Promise<void>;
	agent?: () => Promise<void>;
	/** Starts a conversation with an agent about the stage the ship failed at. */
	sendToAgent?: (failure: {
		id: string;
		project: string;
		stage: StageKey | null;
		note: string | null;
	}) => Promise<void>;
	/** Puts away a run that stopped. */
	onClose: () => void;
}): JSX.Element {
	const { refusals, refuse } = useRefusals<string>();
	const [abandoning, setAbandoning] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [acting, setActing] = useState(false);
	const act = (run: () => Promise<void>, title: string) => {
		setActing(true);
		run()
			.then(askMachineNow, (error: unknown) => refuse("", title, error))
			.finally(() => setActing(false));
	};
	const running = cascade.status === "running";
	const held = cascade.steps.find((step) => HELD.includes(step.status));
	const live = running || cascade.status === "stopped";
	// One way out: a run still going is stopped after an "are you sure".
	const close = () => {
		if (!live) {
			onClose();
			return;
		}
		if (abandonRun !== undefined) {
			setConfirming(true);
		}
	};
	const stop = () => {
		if (abandonRun === undefined) {
			return;
		}
		setConfirming(false);
		setAbandoning(true);
		abandonRun().then(
			() => {
				askMachineNow();
				onClose();
			},
			(error: unknown) => {
				setAbandoning(false);
				refuse("", "Not stopped", error);
			},
		);
	};
	const through = cascade.steps.filter(
		(step) => step.status === "done" || step.status === "dropped",
	).length;
	const failed = cascade.steps.find((step) => HELD.includes(step.status));
	const sending =
		cascade.status === "stopped" &&
		sendToAgent !== undefined &&
		failed !== undefined ? (
			<Button
				size="sm"
				className="pointer-coarse:min-h-11"
				variant="outline"
				disabled={acting || abandoning}
				onClick={() =>
					act(
						() =>
							sendToAgent({
								id: cascade.id,
								project: failed.slug,
								stage:
									failed.stages.find((stage) => stage.state === "failed")
										?.key ?? null,
								note: failed.note ?? null,
							}),
						"Not sent to an agent",
					)
				}
			>
				Send to agent
			</Button>
		) : null;
	const recovery = (
		<>
			{sending}
			{cascade.status === "stopped" &&
				agent !== undefined &&
				cascade.steps.some(
					(step) =>
						step.adopt !== "agent" &&
						step.stages.some(
							(stage) => stage.key === "adopt" && stage.state === "failed",
						),
				) && (
					<Button
						size="sm"
						className="pointer-coarse:min-h-11"
						variant="outline"
						disabled={acting || abandoning}
						onClick={() => act(agent, "Not handed to an agent")}
					>
						Hand to an agent
					</Button>
				)}
		</>
	);
	const attention = attentionOf(cascade, ship);
	const asked =
		attention === null ? null : { attention, slug: askedSlug(cascade, ship) };
	return (
		<section
			aria-label="under way"
			className="flex flex-col gap-5 max-sm:pb-20"
		>
			<div className="flex flex-wrap items-center gap-x-2 whitespace-nowrap">
				<h2 className="font-medium text-sm">
					{running || held === undefined
						? `Shipping ${shipName(cascade.from)}`
						: `Stopped at ${held.slug}`}
				</h2>
				<span className="text-muted-foreground text-sm tabular-nums">
					{through} of {cascade.steps.length}
				</span>
				{asked === null ? null : <ChipFor tone={asked.attention.tone} />}
				<div className="flex items-center gap-2 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-10 max-sm:border-t max-sm:bg-background/90 max-sm:p-3 max-sm:backdrop-blur sm:ml-auto">
					{cascade.status === "stopped" && retry !== undefined && (
						<Button
							size="xs"
							variant="outline"
							className="gap-1.5 max-sm:order-2 max-sm:flex-1 max-sm:border-transparent max-sm:bg-foreground max-sm:font-medium max-sm:text-background pointer-coarse:min-h-11"
							disabled={acting || abandoning}
							onClick={() => act(retry, "Not retried")}
						>
							<RotateCcwIcon data-icon="inline-start" />
							Retry
						</Button>
					)}
					<Button
						size="xs"
						variant={live ? "destructive" : "outline"}
						className="gap-1.5 max-sm:order-1 max-sm:px-4 max-sm:only:flex-1 pointer-coarse:min-h-11"
						disabled={acting || abandoning}
						title={
							live ? "Ends the ship; what published stays published" : undefined
						}
						onClick={close}
					>
						<SquareIcon
							data-icon="inline-start"
							className={live ? "fill-current" : undefined}
						/>
						{live ? "Stop" : "Close"}
					</Button>
				</div>
			</div>
			<Dialog open={confirming} onOpenChange={setConfirming}>
				<DialogContent showCloseButton={false}>
					<DialogHeader>
						<DialogTitle>Stop this ship?</DialogTitle>
						<DialogDescription>
							What already published stays published.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setConfirming(false)}>
							Keep going
						</Button>
						<Button variant="destructive" onClick={stop}>
							Stop
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<Refusal refusal={refusals.get("") ?? null} />
			{cascade.status === "stopped" && <ShipRecap cascade={cascade} />}
			<ShipJobs
				cascade={cascade}
				ship={ship}
				live={running}
				sendSlow={
					sendSlowToAgent === undefined
						? undefined
						: (slow) => act(() => sendSlowToAgent(slow), "Not sent to an agent")
				}
				asked={asked}
				ask={
					asked !== null ? (
						<AskCard asked={asked.attention} recovery={recovery} />
					) : null
				}
			/>
		</section>
	);
}

/**
 * The run as GitHub Actions lays out a workflow run: the projects as a list
 * of jobs on the left, and the picked one's steps and logs on the right.
 */
function ShipJobs({
	cascade,
	ship,
	live,
	asked,
	ask,
	sendSlow,
}: {
	cascade: Cascade;
	ship: Ship | null;
	live: boolean;
	sendSlow?: (slow: SlowStage) => void;
	asked: { attention: Attention; slug: string | null } | null;
	/** The ask to show on the step that needs it. */
	ask: ReactNode;
}): JSX.Element {
	const [picked, setPicked] = useState<string | null>(null);
	const current =
		cascade.steps.find((step) => HELD.includes(step.status)) ??
		cascade.steps.find(
			(step) => !["done", "dropped", "abandoned"].includes(step.status),
		) ??
		cascade.steps[cascade.steps.length - 1];
	const step =
		cascade.steps.find((each) => each.slug === picked) ??
		cascade.steps.find((each) => each.slug === asked?.slug) ??
		current;
	return (
		<div className="grid min-w-0 items-start gap-4 md:grid-cols-[24rem_minmax(0,1fr)]">
			<nav
				aria-label="Ship jobs"
				className="flex flex-col gap-1.5 rounded-lg border bg-card p-2"
			>
				<h3 className="px-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
					Jobs
				</h3>
				{cascade.steps.map((each) => (
					<button
						key={each.slug}
						type="button"
						aria-current={each.slug === step?.slug}
						onClick={() => setPicked(each.slug)}
						className={cn(
							"flex min-h-11 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted/60",
							each.slug === step?.slug && "bg-muted font-medium",
						)}
					>
						<span aria-hidden className="shrink-0">
							{ICONS[jobState(each)]}
						</span>
						<span className="min-w-0 flex-1 truncate">{each.slug}</span>
						<JobTime step={each} live={live} />
						<span
							className={cn(
								"text-xs",
								each.slug === asked?.slug
									? asked.attention.tone === "asks"
										? "font-medium text-amber-600 dark:text-amber-400"
										: "font-medium text-destructive"
									: "text-muted-foreground",
							)}
						>
							{statusLabel(each)}
						</span>
					</button>
				))}
			</nav>
			{step !== undefined && (
				<div className="min-w-0 rounded-lg border bg-card p-4">
					<ol aria-label="Ship cascade" className="flex flex-col">
						<ProjectStage
							key={step.slug}
							cascade={cascade}
							step={step}
							ship={step.status === "shipping" ? ship : null}
							live={live}
							ask={step.slug === asked?.slug ? ask : null}
							sendSlow={sendSlow}
						/>
					</ol>
				</div>
			)}
		</div>
	);
}
