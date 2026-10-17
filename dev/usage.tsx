import type { JSX, ReactNode } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#dev/components/ui/popover.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Compaction, Message, Usage } from "../conversations";
import { useNow } from "./hooks/use-now";
import { span } from "./work";

/** The compactions in `messages`, oldest first. */
export function compactionsIn(messages: readonly Message[]): Compaction[] {
	return messages.flatMap((message) =>
		message.parts.flatMap((part) =>
			part.type === "compaction" && part.status === "completed" ? [part] : [],
		),
	);
}

const COMPACT = new Intl.NumberFormat("en", {
	notation: "compact",
	maximumFractionDigits: 1,
});

/** A count of tokens in a few characters: `840`, `84k`, `1.2M`. */
export function tokens(count: number): string {
	return COMPACT.format(count).replace("K", "k");
}

/** An amount of money as Zed writes it: `0.09 USD`, to a tenth of a cent below one. */
export function money({
	amount,
	currency,
}: {
	amount: number;
	currency: string;
}): string {
	return `${amount.toFixed(amount > 0 && amount < 0.01 ? 3 : 2)} ${currency}`;
}

/** How full the context may get before the ring warns. */
const NEARLY_FULL = 0.8;

const RADIUS = 6.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * A thin ring filled as far as the context is, as in Zed, quiet until it
 * nears full; on hover, the context, the tokens read and written, and what
 * the session cost, as far as the agent says. Nothing until it says.
 */
export function ContextMeter({
	usage,
	compactions = [],
}: {
	usage: Usage;
	/** The conversation's compactions so far, oldest first. */
	compactions?: readonly Compaction[];
}): JSX.Element | null {
	const { context, input, cached, output, cost } = usage;
	const now = useNow(compactions.length > 0);
	if (usage.opencode !== undefined) {
		return <OpenCodeMeter usage={usage} />;
	}
	if (context === null || context.size <= 0) {
		return null;
	}
	const share = Math.min(context.used / context.size, 1);
	const percent = Math.round(share * 100);
	const last = compactions.at(-1) ?? null;
	return (
		<Popover>
			<PopoverTrigger
				openOnHover
				delay={150}
				aria-label={`${percent}% of context used`}
				className={cn(
					"inline-flex size-6 pointer-coarse:size-11 shrink-0 cursor-default items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
					share >= NEARLY_FULL && "text-warning hover:text-warning",
				)}
			>
				<svg
					aria-hidden
					viewBox="0 0 16 16"
					className="-rotate-90 size-4 pointer-coarse:size-5"
				>
					<title>{`${percent}% of context used`}</title>
					<circle
						cx="8"
						cy="8"
						r={RADIUS}
						fill="none"
						strokeWidth="1.5"
						className="stroke-current opacity-25"
					/>
					<circle
						cx="8"
						cy="8"
						r={RADIUS}
						fill="none"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeDasharray={CIRCUMFERENCE}
						strokeDashoffset={CIRCUMFERENCE * (1 - share)}
						className={cn("stroke-current", share === 0 && "hidden")}
					/>
					{last !== null && (
						// A dot in the ring: the context was folded at least once.
						<circle cx="8" cy="8" r="1.75" className="fill-current" />
					)}
				</svg>
			</PopoverTrigger>
			<PopoverContent
				side="top"
				align="start"
				className="w-auto min-w-48 gap-0 p-0"
			>
				<Section title="Context">
					{percent}%<Dot />
					{tokens(context.used)}
					<span className="text-muted-foreground"> / </span>
					{tokens(context.size)}
				</Section>
				{(input > 0 || output > 0) && (
					<Section
						title="Tokens"
						hint={
							cached > 0 ? `${tokens(cached)} of those in from cache` : null
						}
					>
						{tokens(input)} in
						<Dot />
						{tokens(output)} out
					</Section>
				)}
				{cost !== null && <Section title="Cost">{money(cost)}</Section>}
				{last !== null && (
					<Section
						title={
							compactions.length === 1
								? "Compacted"
								: `Compacted ${compactions.length}×`
						}
						hint={last.until === null ? null : `${span(last.until, now)} ago`}
					>
						{last.before !== null && last.after !== null
							? `${tokens(last.before)} → ${tokens(last.after)}`
							: "once"}
					</Section>
				)}
			</PopoverContent>
		</Popover>
	);
}

/** One part of the meter's card: a quiet title over its figures. */
function Section({
	title,
	hint = null,
	children,
}: {
	title: string;
	hint?: string | null;
	children: ReactNode;
}): JSX.Element {
	return (
		<section
			aria-label={title}
			className="flex flex-col gap-1 border-border border-t px-3 py-2.5 first:border-t-0"
		>
			<h3 className="text-muted-foreground text-xs">{title}</h3>
			<p className="tabular-nums">{children}</p>
			{hint !== null && <p className="text-muted-foreground text-xs">{hint}</p>}
		</section>
	);
}

function Dot(): JSX.Element {
	return (
		<span aria-hidden className="px-1.5 text-muted-foreground">
			•
		</span>
	);
}

/** Draft ACP measurements retain their scope even when context is absent. */
function OpenCodeMeter({ usage }: { usage: Usage }): JSX.Element {
	return (
		<Popover>
			<PopoverTrigger
				aria-label="OpenCode usage"
				className="text-muted-foreground text-xs"
			>
				Usage
			</PopoverTrigger>
			<PopoverContent side="top" align="start" className="max-w-sm gap-0 p-0">
				<OpenCodeReport usage={usage} />
			</PopoverContent>
		</Popover>
	);
}

/** Shared rendering for fixture inspection and the live meter. */
export function OpenCodeReport({ usage }: { usage: Usage }): JSX.Element {
	const report = usage.opencode;
	const turn = report?.turns.at(-1);
	const count = (value: number | null | undefined) =>
		value == null ? "Unknown" : tokens(value);
	const latency = (at: string | null | undefined) =>
		turn === undefined || at == null
			? "Unknown"
			: `${Math.max(0, Date.parse(at) - Date.parse(turn.at))} ms`;
	return (
		<>
			<Section
				title="Last dispatched model"
				hint={`Requested: ${turn?.requested ?? "Unknown"} · confirmed by ACP settings at dispatch`}
			>
				{turn?.confirmed ?? "Unknown"}
			</Section>
			<Section
				title="Last turn tokens"
				hint="ACP prompt response · parent session only · cache counts shown separately"
			>
				{count(turn?.tokens?.input)} in
				<Dot />
				{count(turn?.tokens?.output)} out
				<br />
				Cache read: {count(turn?.tokens?.cachedRead)}
				<Dot />
				Cache write: {count(turn?.tokens?.cachedWrite)}
			</Section>
			<Section
				title="Measured latency"
				hint="Arbor dispatch to first text / turn end; includes tools and waits"
			>
				First text: {latency(turn?.firstText)}
				<br />
				Elapsed: {latency(turn?.until)}
			</Section>
			<Section title="Context" hint="ACP usage update · parent session">
				{usage.context === null
					? "Unknown"
					: `${tokens(usage.context.used)} / ${tokens(usage.context.size)}`}
			</Section>
			<Section
				title="Reported cost"
				hint={`ACP usage update · cumulative session total, not per turn · ${report?.costAt ?? "observation time unknown"}`}
			>
				{usage.cost === null ? "Unknown" : money(usage.cost)}
			</Section>
			<Section title="Additional charges">Unknown: not verified by ACP</Section>
			<Section
				title="Remaining quota"
				hint="No authoritative ACP quota; mixed-model allowance and reset time unknown"
			>
				Unknown ·{" "}
				<a href="https://opencode.ai/console" target="_blank" rel="noreferrer">
					OpenCode Console
				</a>
			</Section>
			{report?.retry != null && (
				<Section
					title="Provider retry"
					hint={`${report.retry.type ?? "Provider error"} · HTTP ${report.retry.status ?? "unknown"} · ${report.retry.nextRetryAt ?? "Retry time unknown"}`}
				>
					Attempt {report.retry.attempt ?? "unknown"}: {report.retry.message}
				</Section>
			)}
		</>
	);
}
