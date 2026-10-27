import type { ShipStep } from "@stringsync/splates-server/ship";
import { useReactive } from "@webappwiz/react";
import { LoaderCircleIcon, PackageIcon } from "lucide-react";
import { type JSX, useEffect } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { cn } from "#web/lib/utils.ts";
import { askMachineNow } from "./machine";
import { Refusal } from "./refusal";
import type { ShipApproval } from "./ship-approval";
import { ShipBumpSelector } from "./ship-bump-selector";

/**
 * The plan to ship the project `approval` names at its selected bump, drawn by
 * the server as it opens: each project in dependency order, the version it goes
 * to, what it publishes, which packages of those before it it takes, and why it
 * ships or only takes its bump. Approve starts the whole cascade on the server,
 * the person's alone, and the bars' ship badge follows it from there; npm still
 * asks the person at each publish.
 */
export function ShipDialog({
	approval,
	onClose,
	onApproved,
}: {
	approval: ShipApproval;
	onClose: () => void;
	/** Called after the ship starts, such as to tell the agent that asked for it. */
	onApproved?: () => void;
}): JSX.Element {
	const project = approval.project;
	const { plan, bump, refusal, starting } = useReactive(
		approval,
		(each) => ({
			plan: each.plan,
			bump: each.bump,
			refusal: each.refusal,
			starting: each.starting,
		}),
		["changed"],
	);
	useEffect(() => {
		void approval.draw();
	}, [approval]);
	const approve = async () => {
		if (await approval.approve()) {
			onApproved?.();
			askMachineNow();
			onClose();
		}
	};
	return (
		<Dialog open onOpenChange={(next) => !next && onClose()}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Ship {project}</DialogTitle>
					<DialogDescription>
						Publishes {project}, then carries the release through every project
						that depends on it, in this order. npm asks you at each publish.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<span className="text-sm font-medium">Release type</span>
					<ShipBumpSelector
						label="Release type"
						value={bump}
						onChange={(chosen) => void approval.choose(chosen)}
						disabled={starting}
					/>
				</div>
				{plan === null && refusal === null && (
					<p className="flex items-center gap-2 text-muted-foreground">
						<LoaderCircleIcon className="size-4 animate-spin" />
						Drawing the plan…
					</p>
				)}
				{plan !== null && <PlanSteps steps={plan.steps} />}
				<Refusal refusal={refusal} className="text-sm" />
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button
						disabled={plan === null || starting}
						onClick={() => void approve()}
					>
						{starting ? (
							<LoaderCircleIcon className="animate-spin" />
						) : (
							<PackageIcon />
						)}
						Approve
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** The plan's projects, one row each, numbered in the order they go. */
function PlanSteps({ steps }: { steps: ShipStep[] }): JSX.Element {
	return (
		<ol aria-label="Ship plan" className="flex flex-col divide-y">
			{steps.map((step, index) => (
				<li key={step.slug} className="flex gap-3 py-2">
					<span className="w-5 shrink-0 text-right text-muted-foreground tabular-nums">
						{index + 1}
					</span>
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<p className="flex flex-wrap items-baseline gap-x-2">
							<span className="font-medium">{step.slug}</span>
							<span
								className={cn(
									"rounded-full px-1.5 text-[11px]",
									step.action === "ship"
										? "bg-primary/10 text-primary"
										: "bg-muted text-muted-foreground",
								)}
							>
								{step.action === "ship" ? "ships" : "takes its bump"}
							</span>
							<span className="text-muted-foreground text-xs tabular-nums">
								{versionOf(step)}
							</span>
						</p>
						{step.publishes.length > 0 && (
							<p className="text-muted-foreground text-xs">
								Publishes {step.publishes.join(", ")}
							</p>
						)}
						{step.takes.length > 0 && (
							<p className="text-muted-foreground text-xs">
								Takes{" "}
								{step.takes
									.map(
										(use) =>
											`${use.pins.map((pin) => pin.name).join(", ")} from ${use.project}`,
									)
									.join("; ")}
							</p>
						)}
						<p className="text-muted-foreground text-xs">{whyOf(step)}</p>
					</div>
				</li>
			))}
		</ol>
	);
}

/** The version a step goes to from where it is, or where it stays for a bump. */
export function versionOf(step: ShipStep): string {
	if (step.to === null) {
		return step.from ?? "";
	}
	return `${step.from ?? "?"} → ${step.to}`;
}

/** Why a step ships or only takes its bump, as a sentence. */
function whyOf(step: ShipStep): string {
	if (step.takes.length === 0) {
		return "The project shipped.";
	}
	return step.action === "ship"
		? `Ships too, since ${step.why}.`
		: `Only takes its bump: ${step.why}.`;
}
