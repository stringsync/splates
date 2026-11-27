import type {
	AutopickAgent,
	Lineup,
	LineupColor,
	RouteKind,
} from "@splates/server/autopick";
import type { AgentPick } from "@splates/server/models";
import {
	BugIcon,
	CircleDashedIcon,
	type LucideIcon,
	PenToolIcon,
	ServerCogIcon,
	TelescopeIcon,
} from "lucide-react";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";
import { AgentMark } from "./agent-icons";

/** A kind's icon in its color. */
export function KindIcon({
	kind,
	className,
}: {
	kind: RouteKind;
	className?: string;
}): JSX.Element {
	const { Icon, color } = KIND_LOOKS[kind];
	return (
		<Icon aria-hidden className={cn("size-4 shrink-0", color, className)} />
	);
}

/** A lineup's color as a small square dot. */
export function LineupDot({
	color,
	className,
}: {
	color: LineupColor;
	className?: string;
}): JSX.Element {
	return (
		<span
			aria-hidden
			className={cn(
				"size-2.5 shrink-0 rounded-[3px]",
				LINEUP_LOOKS[color].dot,
				className,
			)}
		/>
	);
}

/** The marks of the agents a lineup picks, in its order. */
export function LineupMarks({
	lineup,
	className,
}: {
	lineup: Lineup;
	className?: string;
}): JSX.Element {
	return (
		<span
			aria-hidden
			className={cn("flex shrink-0 items-center gap-1", className)}
		>
			{lineup.picks.map((pick, at) => (
				<AgentMark
					// biome-ignore lint/suspicious/noArrayIndexKey: a pick is its place in the lineup
					key={at}
					agent={pick.agent}
					className="size-3.5"
				/>
			))}
		</span>
	);
}

/** An effort in words: `High effort`, `Extra high effort`, `Default effort`. */
export function effortLabel(effort: string | undefined): string {
	if (effort === undefined) {
		return "Default effort";
	}
	const words: Record<string, string> = { xhigh: "Extra high" };
	const word =
		words[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1);
	return `${word} effort`;
}

/** A pick's agent and model by name: `Claude` and `Opus 5.5`. */
export function pickNames(
	agents: readonly AutopickAgent[],
	pick: AgentPick,
): { agent: string; model: string } {
	const agent = agents.find((each) => each.id === pick.agent);
	return {
		agent: agent?.name ?? pick.agent,
		model:
			pick.model === undefined
				? "Default model"
				: (agent?.models.find((each) => each.id === pick.model)?.name ??
					pick.model),
	};
}

/** How each lineup color is drawn: a dot, a pale tile, and a ring when chosen. */
export const LINEUP_LOOKS: Record<
	LineupColor,
	{ dot: string; tile: string; edge: string }
> = {
	emerald: {
		dot: "bg-emerald-500",
		tile: "bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:hover:bg-emerald-500/25",
		edge: "border-l-emerald-500 border-t-emerald-500",
	},
	sky: {
		dot: "bg-sky-500",
		tile: "bg-sky-50 hover:bg-sky-100 dark:bg-sky-500/15 dark:hover:bg-sky-500/25",
		edge: "border-l-sky-500 border-t-sky-500",
	},
	violet: {
		dot: "bg-violet-500",
		tile: "bg-violet-50 hover:bg-violet-100 dark:bg-violet-500/15 dark:hover:bg-violet-500/25",
		edge: "border-l-violet-500 border-t-violet-500",
	},
	pink: {
		dot: "bg-pink-500",
		tile: "bg-pink-50 hover:bg-pink-100 dark:bg-pink-500/15 dark:hover:bg-pink-500/25",
		edge: "border-l-pink-500 border-t-pink-500",
	},
	red: {
		dot: "bg-red-500",
		tile: "bg-red-50 hover:bg-red-100 dark:bg-red-500/15 dark:hover:bg-red-500/25",
		edge: "border-l-red-500 border-t-red-500",
	},
	amber: {
		dot: "bg-amber-500",
		tile: "bg-amber-50 hover:bg-amber-100 dark:bg-amber-500/15 dark:hover:bg-amber-500/25",
		edge: "border-l-amber-500 border-t-amber-500",
	},
	slate: {
		dot: "bg-slate-500",
		tile: "bg-slate-100 hover:bg-slate-200 dark:bg-slate-500/20 dark:hover:bg-slate-500/30",
		edge: "border-l-slate-500 border-t-slate-500",
	},
};

/** Each kind's icon and its color, `unsure` a dashed circle. */
export const KIND_LOOKS: Record<
	RouteKind,
	{ Icon: LucideIcon; color: string }
> = {
	bugfix: { Icon: BugIcon, color: "text-red-500" },
	design: { Icon: PenToolIcon, color: "text-violet-500" },
	open: { Icon: TelescopeIcon, color: "text-teal-600" },
	devops: { Icon: ServerCogIcon, color: "text-orange-500" },
	unsure: { Icon: CircleDashedIcon, color: "text-muted-foreground" },
};
