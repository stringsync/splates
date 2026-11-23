import type { ChainSpend } from "@splates/server/queue/browser";
import type { JSX } from "react";

/** The chain's budget meter, drawn over the question that asks for more. */
export function ChainMeter({ spend }: { spend: ChainSpend }): JSX.Element {
	const out = spend.share >= 1;
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-baseline justify-between gap-2 text-muted-foreground text-xs">
				<span className="truncate">Task chain {spend.chain}</span>
				<span>
					<strong className="font-semibold text-foreground">
						{spend.spent}
					</strong>{" "}
					of {spend.budget}
				</span>
			</div>
			<div
				aria-hidden="true"
				className="h-1.5 overflow-hidden rounded-full bg-muted"
			>
				<div
					className={out ? "h-full bg-destructive" : "h-full bg-primary"}
					style={{ width: `${spend.share * 100}%` }}
				/>
			</div>
		</div>
	);
}
