import { ChevronRightIcon, CircleCheckIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { cn } from "#web/lib/utils.ts";
import { CardBody } from "./card-shell";
import {
	type EvalRounds,
	type Layer,
	layerCounts,
	type Rate,
	type Round,
} from "./eval-rounds";

/**
 * The body of a Done report that ends an eval loop: one row per round, the
 * layer it changed and its pass rate, each opening to why and what it
 * touched, then how the loop went, in the merged card's footer style.
 */
export function EvalDoneBody({
	read,
	lead,
}: {
	read: EvalRounds;
	lead: boolean;
}): JSX.Element {
	const last = read.rounds[read.rounds.length - 1];
	const passing =
		last?.current != null && last.current.passed === last.current.of;
	return (
		<>
			{read.rest !== "" && <CardBody text={read.rest} lead={lead} />}
			<ul aria-label="eval rounds" className="border-border/60 border-t">
				{read.rounds.map((round) => (
					<RoundRow key={round.round} round={round} />
				))}
			</ul>
			<section
				aria-label="how the loop went"
				className="flex flex-col gap-3 border-t px-4 py-3 text-xs"
			>
				<dl className="grid grid-cols-2 gap-x-4 gap-y-2 @md:grid-cols-3">
					<div className="flex flex-col">
						<dt className="text-muted-foreground">Rounds</dt>
						<dd className="font-medium text-sm tabular-nums">
							{read.rounds.length}
						</dd>
					</div>
					<div className="flex flex-col">
						<dt className="text-muted-foreground">Changed</dt>
						<dd className="font-medium text-sm">
							{layerCounts(read.rounds) || "nothing"}
						</dd>
					</div>
					{read.stoppedBy !== null && (
						<div className="flex min-w-0 flex-col">
							<dt className="text-muted-foreground">Stopped by</dt>
							<dd className="font-medium text-sm">{read.stoppedBy}</dd>
						</div>
					)}
				</dl>
				{last?.current != null && (
					<p
						className={cn(
							"flex items-center gap-1.5",
							passing ? "text-success" : "text-warning",
						)}
					>
						<CircleCheckIcon aria-hidden className="size-3.5" />
						{passing
							? "Every repetition passes"
							: `Ended at ${last.current.passed}/${last.current.of}`}
					</p>
				)}
			</section>
		</>
	);
}

/** How each layer a round changed is colored. */
const LAYER_TONES: Record<Layer, string> = {
	skill: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
	judge: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
	scenario: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
	harness: "bg-muted text-muted-foreground",
};

function Segments({ rate }: { rate: Rate | null }): JSX.Element {
	if (rate === null) {
		return <span className="text-muted-foreground">·</span>;
	}
	return (
		<span
			role="img"
			aria-label={`${rate.passed} of ${rate.of} pass`}
			className="flex items-center gap-1"
		>
			<span className="flex gap-0.5">
				{Array.from({ length: rate.of }, (_, index) => (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: a fixed run of segments
						key={index}
						className={cn(
							"h-2 w-4 rounded-sm",
							index < rate.passed ? "bg-emerald-500" : "bg-destructive",
						)}
					/>
				))}
			</span>
			<span className="text-muted-foreground tabular-nums">
				{rate.passed}/{rate.of}
			</span>
		</span>
	);
}

function RoundRow({ round }: { round: Round }): JSX.Element {
	const [open, setOpen] = useState(false);
	const detail = round.why !== "" || round.files !== "";
	return (
		<li className="border-border/60 border-t first:border-t-0">
			<button
				type="button"
				aria-expanded={open}
				disabled={!detail}
				onClick={() => setOpen(!open)}
				className="grid w-full grid-cols-[2rem_5.5rem_1fr_auto_1rem] items-center gap-x-3 px-4 py-2 text-left text-sm enabled:hover:bg-muted/50 @max-md:px-3"
			>
				<span className="text-muted-foreground tabular-nums">
					{round.round}
				</span>
				<span>
					{round.layer !== null && (
						<span
							className={cn(
								"inline-flex h-5 items-center rounded-full px-2 font-medium text-xs",
								LAYER_TONES[round.layer],
							)}
						>
							{round.layer}
						</span>
					)}
				</span>
				<span className="min-w-0 truncate">{round.change}</span>
				<span className="text-xs">
					<Segments rate={round.current} />
				</span>
				<ChevronRightIcon
					aria-hidden
					className={cn(
						"size-3.5 text-muted-foreground transition-transform",
						!detail && "invisible",
						open && "rotate-90",
					)}
				/>
			</button>
			{open && (
				<div className="flex flex-col gap-1.5 bg-muted/40 py-2.5 pr-4 pl-[3.25rem] text-xs @max-md:pr-3">
					{round.why !== "" && (
						<p className="text-muted-foreground">{round.why}</p>
					)}
					{round.baseline !== null && (
						<p className="text-muted-foreground">
							Baseline <Segments rate={round.baseline} />
						</p>
					)}
					{round.files !== "" && (
						<code className="w-fit rounded bg-muted px-1">{round.files}</code>
					)}
				</div>
			)}
		</li>
	);
}
