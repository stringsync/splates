import type { JSX, ReactNode } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#dev/components/ui/popover.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Usage } from "../conversations";

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
export function ContextMeter({ usage }: { usage: Usage }): JSX.Element | null {
	const { context, input, cached, output, cost } = usage;
	if (context === null || context.size <= 0) {
		return null;
	}
	const share = Math.min(context.used / context.size, 1);
	const percent = Math.round(share * 100);
	return (
		<Popover>
			<PopoverTrigger
				openOnHover
				delay={150}
				aria-label={`${percent}% of context used`}
				className={cn(
					"inline-flex size-6 shrink-0 cursor-default items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
					share >= NEARLY_FULL && "text-warning hover:text-warning",
				)}
			>
				<svg aria-hidden viewBox="0 0 16 16" className="-rotate-90 size-4">
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
