import type {
	Cascade,
	CascadeStatus,
	CascadeStep,
	Ship,
} from "@stringsync/splates-server/ship";
import {
	CircleAlertIcon,
	KeyRoundIcon,
	MessageCircleQuestionIcon,
	PackageCheckIcon,
	PackageIcon,
} from "lucide-react";
import { type JSX, useState } from "react";
import { Duration } from "webappwiz/time";
import { Button } from "#web/components/ui/button.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import { dropFromCascade, type MachineStatus } from "./api";
import { useNow } from "./hooks/use-now";
import { cn } from "./lib/utils";
import { askMachineNow } from "./machine";
import { todoAddress } from "./page-address";
import { Refusal, useRefusals } from "./refusal";
import { ShipOutput, ShipWaiting, useShipOpen } from "./ship-badge";
import { versionOf } from "./ship-dialog";
import { STATUS_PILL } from "./status-pill";

/** How long a cascade that ended still shows, for the person to see how it went. */
const SHOWN_AFTER = Duration.mins(60);

/** The statuses a step can be dropped from the run in, as the server allows. */
const DROPPABLE: CascadeStatus[] = [
	"waiting",
	"bumping",
	"asking",
	"stopped",
	"failed",
];

const AMBER =
	"border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400";
const MUTED = "bg-muted text-muted-foreground";
const RED = "border-destructive/30 bg-destructive/10 text-destructive";

/**
 * The machine's ship cascade, on every project's page as a merge under way
 * is, while it runs and for an hour after it ends: amber while npm waits on
 * the person, or a bump task asks them, red where it stopped. It opens each
 * project in the order they go, with where each stands, its bump task, why
 * it stopped, a way to drop it from the run, and npm's page or a field for
 * its code while a publish waits on the person, then what that ship prints.
 */
export function CascadeBadge({
	machine,
}: {
	machine: MachineStatus | null;
}): JSX.Element | null {
	const cascade = machine?.ship?.cascade ?? null;
	const ship = machine?.ship?.ship ?? null;
	const now = useNow(cascade !== null, Duration.mins(1));
	const [open, setOpen] = useShipOpen();
	const [dropping, setDropping] = useState<ReadonlySet<string>>(new Set());
	const { refusals, refuse } = useRefusals<string>();
	if (cascade === null || !shown(cascade, now)) {
		return null;
	}
	const drop = (slug: string) => {
		setDropping((was) => new Set(was).add(slug));
		dropFromCascade(slug).then(askMachineNow, (error: unknown) => {
			setDropping((was) => {
				const left = new Set(was);
				left.delete(slug);
				return left;
			});
			refuse(slug, `${slug} not dropped`, error);
		});
	};
	const { label, icon, tone } = pillOf(cascade, ship);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				title={headingOf(cascade)}
				className={cn(STATUS_PILL, tone, "tabular-nums")}
			>
				{icon}
				{label}
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-[28rem] max-w-[90vw] gap-2 p-3"
			>
				<p className="font-medium text-sm">{headingOf(cascade)}</p>
				{ship !== null && <ShipWaiting ship={ship} />}
				<ol aria-label="Ship cascade" className="flex flex-col divide-y">
					{cascade.steps.map((step) => (
						<StepRow
							key={step.slug}
							step={step}
							dropping={dropping.has(step.slug)}
							onDrop={
								cascade.status === "running" && DROPPABLE.includes(step.status)
									? () => drop(step.slug)
									: null
							}
							refusal={refusals.get(step.slug) ?? null}
						/>
					))}
				</ol>
				{/* Afresh for each project's ship as the cascade moves on. */}
				{open && ship !== null && (
					<ShipOutput key={ship.started} project={ship.project} />
				)}
			</PopoverContent>
		</Popover>
	);
}

/** One project of the cascade: where it stands, its bump task, and why it stopped. */
function StepRow({
	step,
	dropping,
	onDrop,
	refusal,
}: {
	step: CascadeStep;
	/** Whether the person dropped it and the server has yet to say so. */
	dropping: boolean;
	/** Drops it from the run, or null where it cannot be. */
	onDrop: (() => void) | null;
	refusal: string | null;
}): JSX.Element {
	const status = dropping ? "dropped" : step.status;
	return (
		<li aria-label={step.slug} className="flex flex-col gap-0.5 py-1.5">
			<p className="flex items-center gap-2 text-sm">
				<span
					aria-hidden
					className={cn("size-1.5 shrink-0 rounded-full", DOTS[status])}
				/>
				<span className="font-medium">{step.slug}</span>
				<span className="text-muted-foreground text-xs tabular-nums">
					{step.action === "ship" ? versionOf(step) : "bump"}
				</span>
				<span className="ml-auto text-muted-foreground text-xs">
					{STATUSES[status]}
				</span>
				{step.task !== null && (
					<a
						href={`?${new URLSearchParams({ project: step.slug })}${todoAddress(step.task)}`}
						title={`Its bump task in ${step.slug}`}
						className="text-xs underline-offset-2 hover:underline"
					>
						#{step.task}
					</a>
				)}
				{onDrop !== null && !dropping && (
					<Button
						size="xs"
						variant="ghost"
						title="Takes it out of the run, so those after it go on without its new version"
						onClick={onDrop}
					>
						Drop
					</Button>
				)}
			</p>
			{step.note !== null && !dropping && (
				<p className="pl-3.5 text-muted-foreground text-xs">{step.note}</p>
			)}
			<Refusal refusal={refusal} className="pl-3.5" />
		</li>
	);
}

/** What each status says of a project, beside it. */
const STATUSES: Record<CascadeStatus, string> = {
	waiting: "waiting",
	bumping: "bumping",
	asking: "asks you",
	stopped: "stopped",
	shipping: "publishing",
	failed: "failed",
	done: "done",
	dropped: "dropped",
};

const DOTS: Record<CascadeStatus, string> = {
	waiting: "bg-muted-foreground/40",
	bumping: "bg-info",
	asking: "bg-amber-500",
	stopped: "bg-destructive",
	shipping: "bg-info",
	failed: "bg-destructive",
	done: "bg-emerald-500",
	dropped: "bg-muted-foreground/40",
};

function shown(cascade: Cascade, now: number): boolean {
	return (
		cascade.ended === null || now - Date.parse(cascade.ended) < SHOWN_AFTER.ms
	);
}

function headingOf(cascade: Cascade): string {
	const downstream = cascade.steps.length - 1;
	const rest =
		downstream === 0
			? ""
			: ` and ${downstream} project${downstream === 1 ? "" : "s"} downstream`;
	return cascade.status === "running"
		? `Shipping ${cascade.from}${rest}`
		: `Shipped ${cascade.from}${rest}`;
}

function pillOf(
	cascade: Cascade,
	ship: Ship | null,
): { label: string; icon: JSX.Element; tone: string } {
	if (cascade.status === "done") {
		return {
			label: `Shipped ${cascade.from}`,
			icon: <PackageCheckIcon />,
			tone: MUTED,
		};
	}
	if (ship?.waiting != null) {
		return {
			label:
				ship.waiting.kind === "login"
					? "Sign in to npm"
					: ship.waiting.kind === "otp"
						? "npm code"
						: "npm 2FA",
			icon: <KeyRoundIcon />,
			tone: AMBER,
		};
	}
	const held = cascade.steps.find(
		(step) => step.status === "stopped" || step.status === "failed",
	);
	if (held !== undefined) {
		return {
			label: `Ship stopped at ${held.slug}`,
			icon: <CircleAlertIcon />,
			tone: RED,
		};
	}
	const asking = cascade.steps.find((step) => step.status === "asking");
	if (asking !== undefined) {
		return {
			label: `Ship waits on ${asking.slug}`,
			icon: <MessageCircleQuestionIcon />,
			tone: AMBER,
		};
	}
	const ended = cascade.steps.filter(
		(step) => step.status === "done" || step.status === "dropped",
	).length;
	return {
		label: `Shipping ${ended}/${cascade.steps.length}`,
		icon: <PackageIcon />,
		tone: MUTED,
	};
}
