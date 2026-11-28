import { CheckIcon } from "lucide-react";
import { createContext, type JSX } from "react";
import { cn } from "#web/lib/utils.ts";
import { AgentMark } from "./agent-icons";
import { Spinner } from "./pending";

/** The active agent identity shown by the thread's live Buddy avatar. */
export interface ThreadAgent {
	/** The agent's id on the roster (for example, `claude` or `gemini`). */
	id: string;
	/** The agent's display name (for example, `Claude` or `Gemini`). */
	name: string;
}

/** The expressive state of Buddy C1 in a conversation thread. */
export type BuddyState = "idle" | "working" | "merged";

/**
 * Provides the active agent to the latest assistant message's live working
 * row, so the single living Buddy rides inside that row while work runs.
 */
export const LiveBuddyContext = createContext<ThreadAgent | null>(null);

/**
 * Splates' animated stacked-plate buddy wearing the active agent's colored
 * brand mark in a crisp lower-right circular corner pin (Variant C1).
 */
export function BuddyAvatar({
	agent,
	name,
	state = "idle",
	size = 32,
	className,
}: {
	agent: string;
	name?: string;
	state?: BuddyState;
	size?: number;
	className?: string;
}): JSX.Element {
	const pinSize = Math.round(size * 0.54);
	const markSize = Math.round(size * 0.36);
	return (
		<span
			data-slot="buddy-avatar"
			data-state={state}
			data-agent={agent}
			aria-hidden="true"
			title={name}
			style={{ width: size, height: size }}
			className={cn(
				"relative inline-flex shrink-0 items-center justify-center select-none",
				className,
			)}
		>
			<svg
				aria-hidden="true"
				viewBox="0 0 32 32"
				fill="none"
				width={size}
				height={size}
				className={cn(
					"shrink-0 overflow-visible",
					state === "working" && "buddy-working-bob motion-reduce:animate-none",
				)}
			>
				<rect
					x="4"
					y="11"
					width="24"
					height="17"
					rx="6"
					className="fill-zinc-200 stroke-zinc-900/15 dark:fill-[#18181d] dark:stroke-white/14"
					strokeWidth="1.2"
				/>
				<rect
					x="3"
					y="6"
					width="26"
					height="19"
					rx="6.5"
					className="fill-white stroke-zinc-900/22 dark:fill-[#2c2c34] dark:stroke-white/22"
					strokeWidth="1.2"
				/>
				<BuddyEyes state={state} />
			</svg>
			<span
				data-slot="buddy-avatar-pin"
				style={{ width: pinSize, height: pinSize }}
				className="absolute -right-0.5 -bottom-0.5 flex items-center justify-center overflow-hidden rounded-full border-[1.5px] border-background bg-white text-zinc-900 ring-1 ring-zinc-900/15 dark:bg-[#141417] dark:text-zinc-100 dark:ring-white/15"
			>
				<AgentMark
					agent={agent}
					className="shrink-0"
					style={{ width: markSize, height: markSize }}
				/>
			</span>
		</span>
	);
}

/**
 * Compact inline status row carrying the living Buddy beside the agent's
 * current state (working, idle, or merged) below the latest assistant reply.
 */
export function BuddyStatusRow({
	agent,
	state,
	label,
	children,
	className,
}: {
	agent: ThreadAgent;
	state: BuddyState;
	/** Optional status suffix after the agent's name (such as `Merged onto main`). */
	label?: string;
	/** Optional trailing metadata such as a message timestamp. */
	children?: React.ReactNode;
	className?: string;
}): JSX.Element {
	return (
		<div
			data-slot="buddy-status"
			data-state={state}
			className={cn(
				"mt-2 flex items-center gap-2 text-xs tabular-nums",
				state === "merged" ? "text-success" : "text-muted-foreground/75",
				className,
			)}
		>
			<BuddyAvatar agent={agent.id} name={agent.name} state={state} />
			{state === "working" && <Spinner className="size-3.5 shrink-0" />}
			{state === "merged" && (
				<CheckIcon aria-hidden className="size-3.5 shrink-0" />
			)}
			<span className="min-w-0 truncate">
				{label === undefined ? agent.name : `${agent.name} · ${label}`}
			</span>
			{children}
		</div>
	);
}

function BuddyEyes({ state }: { state: BuddyState }): JSX.Element {
	if (state === "merged") {
		return (
			<g data-slot="buddy-eyes" data-expression="merged">
				<path
					d="M10.8 15.6c.75-1.55 2.45-1.55 3.2 0"
					className="stroke-zinc-900 dark:stroke-[#f4f4f5]"
					strokeWidth="1.9"
					strokeLinecap="round"
				/>
				<path
					d="M18 15.6c.75-1.55 2.45-1.55 3.2 0"
					className="stroke-zinc-900 dark:stroke-[#f4f4f5]"
					strokeWidth="1.9"
					strokeLinecap="round"
				/>
			</g>
		);
	}
	return (
		<g
			data-slot="buddy-eyes"
			data-expression={state}
			className={cn(
				state === "idle" && "buddy-eyes-blink motion-reduce:animate-none",
				state === "working" && "buddy-eyes-look motion-reduce:animate-none",
			)}
		>
			<rect
				x="11.8"
				y="12.2"
				width="2.8"
				height="5.6"
				rx="1.4"
				className="fill-zinc-900 dark:fill-[#f4f4f5]"
			/>
			<rect
				x="17.4"
				y="12.2"
				width="2.8"
				height="5.6"
				rx="1.4"
				className="fill-zinc-900 dark:fill-[#f4f4f5]"
			/>
		</g>
	);
}
