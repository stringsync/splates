import type { Cascade, Ship } from "@stringsync/splates-server/ship";
import { shipName } from "@stringsync/splates-server/ship/browser";
import {
	CircleAlertIcon,
	ExternalLinkIcon,
	LoaderCircleIcon,
	TriangleAlertIcon,
} from "lucide-react";
import type { JSX } from "react";
import { buttonVariants } from "#web/components/ui/button.tsx";
import { cn } from "./lib/utils";
import { type Attention, attentionOf } from "./ship-dock";

/**
 * How the ship is going, at the top of its page: the project it is on, how
 * far through it is, and, when the person is needed or it stopped, what for
 * with the one action that answers it.
 */
export function ShipStatusCard({
	cascade,
	ship,
}: {
	cascade: Cascade;
	ship: Ship | null;
}): JSX.Element {
	const attention = attentionOf(cascade, ship);
	const through = cascade.steps.filter(
		(step) => step.status === "done" || step.status === "dropped",
	).length;
	const total = cascade.steps.length;
	const current = cascade.steps.find(
		(step) => !["done", "dropped", "abandoned"].includes(step.status),
	);
	const tone = attention?.tone ?? "going";
	const doing = current?.stages.find((stage) => stage.state === "running");
	const line =
		attention === null
			? current === undefined
				? "All projects are through"
				: `${current.slug}${doing ? `: ${doing.name}` : ""}`
			: attention.title;
	const heading =
		attention === null
			? `Shipping ${shipName(cascade.from)}`
			: attention.tone === "asks"
				? "Needs you"
				: "Stopped";
	const Icon =
		tone === "asks"
			? TriangleAlertIcon
			: tone === "stopped"
				? CircleAlertIcon
				: LoaderCircleIcon;
	const colors = TONES[tone];
	const action = attention?.action ?? null;
	return (
		<section
			aria-label="ship status"
			role="status"
			className={cn(
				"hidden flex-col gap-3 rounded-xl border p-4 md:flex",
				colors.card,
			)}
		>
			<div className="flex items-start gap-3">
				<Icon
					aria-hidden
					className={cn(
						"mt-0.5 shrink-0",
						"size-5",
						colors.icon,
						tone === "going" && "animate-spin",
					)}
				/>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span
						className={cn(
							"font-semibold text-[11px] uppercase tracking-wide",
							colors.icon,
						)}
					>
						{heading}
					</span>
					<span className="font-medium text-base">{line}</span>
					{attention?.detail != null && (
						<span className="text-muted-foreground text-sm">
							{attention.detail}
						</span>
					)}
				</div>
				{action !== null && <Action action={action} tone={tone} />}
				<span className="shrink-0 pt-0.5 text-muted-foreground text-sm tabular-nums">
					{through} of {total}
				</span>
			</div>
			<Bar through={through} total={total} tone={tone} />
		</section>
	);
}

function Action({
	action,
	tone,
}: {
	action: NonNullable<Attention["action"]>;
	tone: keyof typeof TONES;
}): JSX.Element {
	return (
		<a
			href={action.href}
			target={action.external ? "_blank" : undefined}
			rel={action.external ? "noreferrer" : undefined}
			className={cn(
				buttonVariants({
					size: "sm",
					variant: tone === "stopped" ? "destructive" : "ghost",
				}),
				"shrink-0",
				tone === "asks" && TONES.asks.button,
			)}
		>
			{action.label}
			{action.external && <ExternalLinkIcon />}
		</a>
	);
}

function Bar({
	through,
	total,
	tone,
}: {
	through: number;
	total: number;
	tone: keyof typeof TONES;
}): JSX.Element {
	return (
		<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
			<div
				className={cn("h-full rounded-full", TONES[tone].fill)}
				style={{ width: `${total === 0 ? 0 : (through / total) * 100}%` }}
			/>
		</div>
	);
}

const TONES = {
	going: {
		card: "border-foreground/10 bg-muted/30",
		icon: "text-info",
		fill: "bg-info",
	},
	asks: {
		card: "border-amber-500/50 bg-amber-500/10",
		icon: "text-amber-600 dark:text-amber-400",
		fill: "bg-amber-500",
		button:
			"bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:text-amber-300",
	},
	stopped: {
		card: "border-destructive/50 bg-destructive/10",
		icon: "text-destructive",
		fill: "bg-destructive",
	},
} as const;
