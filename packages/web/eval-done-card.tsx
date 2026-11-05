import type { FileDiff } from "@splates/server/tasks";
import { ChevronRightIcon, CircleCheckIcon } from "lucide-react";
import { type JSX, type ReactNode, useEffect, useState } from "react";
import { cn } from "#web/lib/utils.ts";
import { commitDiff } from "./api";
import { CardSection } from "./card-section";
import { CardBody } from "./card-shell";
import { DiffFiles } from "./changes";
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
	const first = read.rounds[0];
	const start = first?.baseline ?? null;
	const end = last?.current ?? null;
	const passing = end !== null && end.passed === end.of;
	return (
		<>
			<section aria-label="outcome" className="flex flex-col gap-3 px-4 py-3">
				<Journey />
				{end !== null && (
					<div>
						<strong
							className={cn(
								"block font-extrabold text-2xl tracking-tight tabular-nums",
								passing ? "text-success" : "text-warning",
							)}
						>
							{start !== null && `${start.passed}/${start.of} → `}
							{end.passed}/{end.of} passing
						</strong>
						<p className="text-muted-foreground text-xs">
							{passing
								? "Every repetition passes"
								: `Ended at ${end.passed} of ${end.of}`}
						</p>
					</div>
				)}
				<dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs @md:grid-cols-4">
					<Fact label="Decision">
						{passing ? "Keep the change" : "Review before keeping"}
					</Fact>
					{read.stoppedBy !== null && (
						<Fact label="Stopping rule">{read.stoppedBy}</Fact>
					)}
					<Fact label="Rounds">{read.rounds.length}</Fact>
					<Fact label="Changed">{layerCounts(read.rounds) || "nothing"}</Fact>
				</dl>
			</section>
			<Evidence read={read} />
			{read.rest !== "" && <CardBody text={read.rest} lead={lead} />}
			<CardSection label="rounds" title="Rounds" className="px-4 py-2.5">
				<ul
					aria-label="eval rounds"
					className="-mx-4 border-border/60 border-t"
				>
					{read.rounds.map((round) => (
						<RoundRow key={round.round} round={round} />
					))}
				</ul>
			</CardSection>
		</>
	);
}

const JOURNEY = ["Base", "Diagnose", "Change", "Compare", "Decide"] as const;

/** The journey of an eval loop, every step behind it by the time it is done. */
function Journey(): JSX.Element {
	return (
		<ol aria-label="journey" className="flex text-[10px] text-success">
			{JOURNEY.map((name) => (
				<li key={name} className="flex-1 text-center">
					<CircleCheckIcon aria-hidden className="mx-auto mb-0.5 size-3" />
					{name}
				</li>
			))}
		</ol>
	);
}

function Fact({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<div className="flex min-w-0 flex-col">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="font-medium text-sm">{children}</dd>
		</div>
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

const ACTION =
	"inline-flex h-7 items-center rounded-md border border-border px-2.5 font-medium text-xs hover:bg-muted/50";

/** Final evidence and View diff, each shown only when the report names its target. */
function Evidence({ read }: { read: EvalRounds }): JSX.Element | null {
	const [open, setOpen] = useState(false);
	if (read.finalBatch === null && read.commit === null) {
		return null;
	}
	return (
		<div className="flex flex-col gap-2 px-4 pb-3 @max-md:px-3">
			<div className="flex gap-2">
				{read.finalBatch !== null && (
					<a
						href={`#evals/${encodeURIComponent(read.finalBatch)}`}
						className={ACTION}
					>
						Final evidence
					</a>
				)}
				{read.commit !== null && (
					<button
						type="button"
						aria-expanded={open}
						onClick={() => setOpen(!open)}
						className={ACTION}
					>
						View diff
					</button>
				)}
			</div>
			{open && read.commit !== null && <CommitDiff sha={read.commit} />}
		</div>
	);
}

function CommitDiff({ sha }: { sha: string }): JSX.Element {
	const [files, setFiles] = useState<FileDiff[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		let current = true;
		commitDiff(sha).then(
			(read) => current && setFiles(read),
			(failed: unknown) => current && setError(String(failed)),
		);
		return () => {
			current = false;
		};
	}, [sha]);
	if (error !== null) {
		return <p className="text-destructive text-xs">{error}</p>;
	}
	if (files === null) {
		return <p className="text-muted-foreground text-xs">Reading the diff…</p>;
	}
	return <DiffFiles files={files} />;
}
