import type { PermissionProposal } from "@stringsync/splates-server/plans";
import type { ShipPlan, ShownRun } from "@stringsync/splates-server/ship";
import { shipName } from "@stringsync/splates-server/ship/browser";
import { BanIcon, CheckIcon, ShipIcon } from "lucide-react";
import { type JSX, useCallback, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { abandonCascade, approveShipPlan, shipRun } from "./api";
import { CardBody, CardShell } from "./card-shell";
import { askMachineNow } from "./machine";
import { PendingSpinner } from "./pending";
import { Refusal, useRefusal } from "./refusal";
import { ShipDock } from "./ship-dock";
import { ProjectStages, versionOf } from "./ship-run";
import { useLiveShips } from "./use-live-ships";

/**
 * Where a plan card stands against the run the server holds: its plan is
 * `proposed` and waits for Approve, `started` once approved (the run's live
 * progress), or `superseded` once a later plan or run replaced it.
 */
export type PlanStanding = "proposed" | "started" | "superseded";

/** How the run the server holds treats the plan `id` a card names. */
export function standingOf(run: ShownRun | null, id: string): PlanStanding {
	const frozen = run?.run.frozen;
	if (run === null || frozen === undefined || frozen.id !== id) {
		return "superseded";
	}
	return run.run.state === "proposed" ? "proposed" : "started";
}

/**
 * The ship plan an agent asks the person to approve: each project's release
 * and why, who adopts and what each must change, and what is left out. Its
 * Approve is the person's and starts the run, after which the card is the
 * run's live progress, as the Ships page shows it. A card for a plan that was
 * replaced shows as such and cannot be approved.
 */
export function ShipPlanCard({
	proposal,
}: {
	proposal: PermissionProposal;
}): JSX.Element {
	const id = proposal.shipPlan ?? "";
	const live = useLiveShips();
	const [run, setRun] = useState<ShownRun | null | undefined>(undefined);
	const { refusal, attempt } = useRefusal();
	const [busy, setBusy] = useState<"approve" | "stop" | null>(null);
	const cascade = live?.cascade ?? null;
	const read = useCallback(() => shipRun().then(setRun, () => undefined), []);
	// Read when the card opens, and again as the cascade moves on.
	const cascadeStatus = cascade?.status;
	useEffect(() => {
		void cascadeStatus;
		void read();
	}, [read, cascadeStatus]);
	const standing = run === undefined ? null : standingOf(run, id);
	const plan =
		standing === null || standing === "superseded" ? null : run?.plan;
	const started =
		standing === "started" &&
		cascade !== null &&
		cascade.id === run?.run.cascade;
	const title = `Ship ${proposal.title ?? ""}`.trim();
	const approve = () => {
		setBusy("approve");
		void attempt(
			approveShipPlan(id)
				.then(read)
				.then(askMachineNow)
				.finally(() => setBusy(null)),
			"Not approved",
		);
	};
	const stop = () => {
		setBusy("stop");
		void attempt(
			abandonCascade()
				.then(askMachineNow)
				.finally(() => setBusy(null)),
			"Not stopped",
		);
	};
	return (
		<CardShell
			label="ship plan"
			Icon={ShipIcon}
			title={title}
			tone={
				standing === "superseded"
					? "neutral"
					: standing === "proposed"
						? "warning"
						: "info"
			}
		>
			{started && cascade !== null ? (
				<div className="flex flex-col gap-3 px-4 py-3">
					<h3 className="font-medium text-sm">
						{cascade.status === "running"
							? `Shipping ${shipName(cascade.from)}`
							: `Ship of ${shipName(cascade.from)} ${cascade.status}`}
					</h3>
					<ProjectStages
						cascade={cascade}
						ship={live?.ship ?? null}
						live={cascade.status === "running"}
					/>
					<ShipDock cascade={cascade} ship={live?.ship ?? null} />
				</div>
			) : plan ? (
				<PlanSteps plan={plan} />
			) : (
				<CardBody text={proposal.body} />
			)}
			<div className="flex flex-wrap items-center justify-end gap-2 border-border/60 border-t px-4 py-2.5">
				{standing === "superseded" ? (
					<span className="flex items-center gap-1 text-muted-foreground text-xs">
						<BanIcon className="size-3.5" />
						Superseded: a later plan replaced this one
					</span>
				) : standing === "proposed" ? (
					<Button
						size="sm"
						disabled={busy !== null}
						onClick={approve}
						className="gap-1.5"
					>
						{busy === "approve" ? (
							<PendingSpinner shown />
						) : (
							<CheckIcon data-icon="inline-start" />
						)}
						Approve and start
					</Button>
				) : cascade?.status === "running" ? (
					<Button
						size="sm"
						variant="outline"
						disabled={busy !== null}
						onClick={stop}
						className="gap-1.5"
					>
						{busy === "stop" ? (
							<PendingSpinner shown />
						) : (
							<BanIcon data-icon="inline-start" />
						)}
						Stop
					</Button>
				) : standing === "started" ? (
					<span className="flex items-center gap-1 text-xs">
						<CheckIcon className="size-3.5 text-success" strokeWidth={3} />
						Approved
					</span>
				) : null}
			</div>
			<Refusal refusal={refusal} />
		</CardShell>
	);
}

/** Each project of the plan in the order it goes: its release, why, what it takes and must change. */
function PlanSteps({ plan }: { plan: ShipPlan }): JSX.Element {
	return (
		<div className="flex flex-col gap-3 px-4 py-3 text-sm">
			<ol aria-label="Ship plan" className="flex flex-col gap-3">
				{plan.steps.map((step) => (
					<li key={step.slug} className="flex flex-col gap-0.5">
						<div className="flex flex-wrap items-baseline gap-x-2">
							<span className="font-medium">{step.slug}</span>
							<span className="text-muted-foreground text-xs tabular-nums">
								{step.action === "ship"
									? `${versionOf(step)} (${step.bump})`
									: "takes its bump"}
							</span>
						</div>
						<span className="text-muted-foreground text-xs">{step.why}</span>
						{step.takes.length > 0 && (
							<span className="text-muted-foreground text-xs">
								Takes:{" "}
								{step.takes
									.flatMap((use) =>
										use.pins.map((pin) => `${pin.name}@${pin.version}`),
									)
									.join(", ")}
							</span>
						)}
						{step.adopt !== undefined && (
							<span className="text-xs">Adopting: {step.adopt}</span>
						)}
					</li>
				))}
			</ol>
			{plan.skipped !== undefined && plan.skipped.length > 0 && (
				<p className="text-muted-foreground text-xs">
					Left out: {plan.skipped.join(", ")}
				</p>
			)}
		</div>
	);
}
