import { makeAssistantDataUI } from "@assistant-ui/react";
import type { EvalRun } from "@splates/server/conversations";
import {
	ArrowDownIcon,
	CircleIcon,
	CircleSlashIcon,
	LoaderCircleIcon,
	ScaleIcon,
	SquareIcon,
} from "lucide-react";
import {
	createContext,
	type JSX,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { Button } from "#web/components/ui/button.tsx";
import { CardShell } from "./card-shell";
import { cancelEval } from "./conversation-api";
import { judgeDisplay } from "./eval-judge";
import { type EvalLive, evalLiveOf, evalRunOfId } from "./eval-live";
import { Coded } from "./eval-proposal-card";
import {
	EvalReportCard,
	EvalTranscript,
	formatAgent,
} from "./eval-report-card";
import { useNow } from "./hooks/use-now";
import { cn } from "./lib/utils";
import { PendingSpinner, useShowPending } from "./pending";

/**
 * The evals a conversation's agent ran, so `EvalRunUI` can draw each in the
 * thread, and the conversation, so a running one's card can cancel it.
 */
export const EvalRuns = createContext<{
	conversation: string | null;
	runs: readonly EvalRun[];
}>({ conversation: null, runs: [] });

/** Renders a `data-eval-run` part: the one card of an eval run, which follows it to its end. */
export const EvalRunUI = makeAssistantDataUI<{ id: string }>({
	name: "eval-run",
	render: ({ data }) => <EvalRunLine id={data.id} />,
});

/**
 * A running eval as one card that fills in as it goes: the transcript so
 * far, the checks and judge waiting their turn, and the time and cost. It is
 * the same card as the report it becomes when the run ends.
 */
export function EvalLiveCard({
	live,
	onCancel,
}: {
	live: EvalLive;
	/** Cancels the run; the card offers Cancel only with it, while the run can be. */
	onCancel?: () => Promise<void>;
}): JSX.Element {
	const cancelled = live.cancelled !== null;
	const running = live.report === null && !live.stopped && !cancelled;
	const now = useNow(running);
	if (live.report !== null) {
		return <EvalReportCard report={live.report} />;
	}
	const label = running
		? "Eval running"
		: cancelled
			? "Eval cancelled"
			: "Eval stopped";
	const seconds = Math.max(0, Math.round((now - live.startedAt) / 1000));
	const aside = [
		formatAgent(live.agent),
		live.turns > 1 ? `turn ${live.turn} of ${live.turns}` : null,
		running ? elapsed(seconds) : null,
		live.usd === null ? null : `$${live.usd.toFixed(2)}`,
	].filter((part): part is string => part !== null && part !== "");
	const judge = judgeDisplay(live.judge)?.name ?? "Jev";
	const doing =
		live.phase === "checks"
			? "Running the checks"
			: live.phase === "judge"
				? `${judge} is judging`
				: "The agent is working";
	return (
		<div data-slot="eval-live">
			<CardShell
				label={label}
				Icon={running ? LoaderCircleIcon : CircleSlashIcon}
				title={label}
				tone={running ? "eval" : "neutral"}
				ringed={false}
				aside={
					<span className="text-[11.5px] text-muted-foreground">
						{aside.join(" · ")}
					</span>
				}
			>
				<h3 className="m-0 px-4 pt-3 pb-2.5 font-bold text-[15.5px] leading-[1.3] @max-md:px-3">
					{live.group !== null && (
						<span className="font-medium text-muted-foreground">
							<Coded text={`${live.group} `} />
						</span>
					)}
					<Coded text={live.eval} />
				</h3>
				<div className="flex flex-col @xl:grid @xl:grid-cols-[1fr_1.15fr] @xl:border-t">
					<FollowingTranscript steps={live.lines.length}>
						<EvalTranscript
							seededCount={live.seeded}
							items={live.lines.map((line, index) => ({ index, line }))}
						>
							{running && (
								<div
									role="status"
									className="inline-flex items-center gap-1.5 self-start text-[12.5px] text-muted-foreground"
								>
									<LoaderCircleIcon
										aria-hidden
										className="size-[13px] shrink-0 animate-spin"
									/>
									{doing}
								</div>
							)}
						</EvalTranscript>
					</FollowingTranscript>
					<section
						aria-label="Checks"
						className="rule-t flex flex-col gap-2 px-4 py-3 @max-md:px-3 @xl:border-t-0 @xl:[background-image:none]"
					>
						<ul className="m-0 flex list-none flex-col gap-2 p-0">
							{live.checks.map((check) => (
								<Waiting key={check.id} text={check.about} />
							))}
							{live.judge !== null && (
								<Waiting text="the reply and transcript" judge={judge} />
							)}
						</ul>
						{running && (live.checks.length > 0 || live.judge !== null) && (
							<p className="m-0 text-[12px] text-muted-foreground">
								Checks and the judge run once the agent's last turn ends.
							</p>
						)}
						{cancelled && (live.checks.length > 0 || live.judge !== null) && (
							<p className="m-0 text-[12px] text-muted-foreground">
								Not run: the eval was cancelled.
							</p>
						)}
					</section>
				</div>
				{cancelled ? (
					<div className="flex flex-wrap items-center gap-2 rule-t px-4 py-2.5 text-xs @max-md:px-3">
						<CircleSlashIcon aria-hidden className="size-3.5 shrink-0" />
						Cancelled by you
						{live.cancelled !== null &&
							` at ${elapsed(Math.max(0, Math.round((live.cancelled - live.startedAt) / 1000)))}`}{" "}
						· the agent was told
					</div>
				) : (
					running &&
					live.cancellable &&
					onCancel !== undefined && (
						<CancelRow
							cancelling={live.cancelling !== null}
							onCancel={onCancel}
						/>
					)
				)}
			</CardShell>
		</div>
	);
}

/**
 * The running transcript, held to a set height and kept on its newest step.
 * Scrolling up to read stops the following and offers a way back, counting
 * the steps that came in meanwhile; reaching the bottom again resumes it.
 */
function FollowingTranscript({
	steps,
	children,
}: {
	steps: number;
	children: ReactNode;
}): JSX.Element {
	const scrollRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const pinnedRef = useRef(true);
	// The step count when following stopped, or null while following.
	const [leftAt, setLeftAt] = useState<number | null>(null);
	const [atTop, setAtTop] = useState(true);
	const stepsRef = useRef(steps);
	stepsRef.current = steps;

	useEffect(() => {
		const scroller = scrollRef.current;
		const content = contentRef.current;
		if (scroller === null || content === null) {
			return;
		}
		let lastTop = scroller.scrollTop;
		let lastHeight = scroller.scrollHeight;
		const atBottom = () =>
			scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 2;
		const pin = () => {
			if (pinnedRef.current) {
				scroller.scrollTop = scroller.scrollHeight;
			}
		};
		// A pin's own scroll event can land after new steps grew the height and
		// read as "not at bottom"; only an upward move at an unchanged height is
		// the user scrolling away.
		const onScroll = () => {
			if (atBottom()) {
				pinnedRef.current = true;
				setLeftAt(null);
			} else if (
				scroller.scrollTop < lastTop &&
				scroller.scrollHeight === lastHeight &&
				pinnedRef.current
			) {
				pinnedRef.current = false;
				setLeftAt(stepsRef.current);
			}
			setAtTop(scroller.scrollTop <= 0);
			lastTop = scroller.scrollTop;
			lastHeight = scroller.scrollHeight;
		};
		pin();
		scroller.addEventListener("scroll", onScroll, { passive: true });
		const observer = new ResizeObserver(pin);
		observer.observe(content);
		return () => {
			scroller.removeEventListener("scroll", onScroll);
			observer.disconnect();
		};
	}, []);

	const unseen = leftAt === null ? 0 : Math.max(0, steps - leftAt);
	return (
		<div className="relative min-w-0">
			<div
				ref={scrollRef}
				data-slot="eval-live-transcript"
				className={cn(
					"max-h-[360px] overflow-y-auto overscroll-contain [scrollbar-width:thin]",
					!atTop &&
						"[mask-image:linear-gradient(to_bottom,transparent,#000_40px)]",
				)}
			>
				<div ref={contentRef}>{children}</div>
			</div>
			{leftAt !== null && (
				<button
					type="button"
					onClick={() => {
						const scroller = scrollRef.current;
						pinnedRef.current = true;
						setLeftAt(null);
						scroller?.scrollTo({
							top: scroller.scrollHeight,
							behavior: "smooth",
						});
					}}
					className="-translate-x-1/2 absolute bottom-3 left-1/2 z-10 inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 font-medium text-[12.5px] text-background shadow-lg"
				>
					<ArrowDownIcon aria-hidden className="size-[13px] shrink-0" />
					{unseen === 0
						? "Latest"
						: `Latest · ${unseen} new ${unseen === 1 ? "step" : "steps"}`}
				</button>
			)}
		</div>
	);
}

/** The card's action row while the run can be cancelled: Cancel, then Cancelling until it ends. */
function CancelRow({
	cancelling,
	onCancel,
}: {
	cancelling: boolean;
	onCancel: () => Promise<void>;
}): JSX.Element {
	const [sending, setSending] = useState(false);
	const [refused, setRefused] = useState<string | null>(null);
	const busy = sending || cancelling;
	const showBusy = useShowPending(busy);
	return (
		<div className="flex flex-wrap items-center justify-end gap-2 rule-t px-4 py-2.5 @max-md:px-3">
			{refused !== null && (
				<span role="alert" className="mr-auto text-destructive text-xs">
					{refused}
				</span>
			)}
			<Button
				size="sm"
				variant="outline"
				disabled={busy}
				onClick={() => {
					setSending(true);
					setRefused(null);
					onCancel().then(
						() => setSending(false),
						(error: unknown) => {
							setSending(false);
							setRefused(
								error instanceof Error ? error.message : "Not cancelled",
							);
						},
					);
				}}
				className="gap-1.5 in-data-sheet:h-11 in-data-sheet:flex-1 in-data-sheet:text-base"
			>
				{busy && showBusy ? (
					<PendingSpinner shown />
				) : (
					<SquareIcon
						data-icon="inline-start"
						className="size-3 fill-current text-destructive"
					/>
				)}
				{cancelling ? "Cancelling" : "Cancel eval"}
			</Button>
		</div>
	);
}

/** A check or the judge, not yet run. */
function Waiting({
	text,
	judge,
}: {
	text: string;
	judge?: string;
}): JSX.Element {
	return (
		<li className="flex items-start gap-2 text-[13px] text-muted-foreground leading-[1.45] [&_code]:[overflow-wrap:anywhere]">
			<CircleIcon
				aria-label="waiting"
				className="mt-0.5 size-3.5 shrink-0 stroke-[2]"
			/>
			<span className="min-w-0 flex-1">
				{judge !== undefined && (
					<span className="mr-1 inline-flex items-center gap-1 font-semibold">
						<ScaleIcon aria-hidden className="size-3.5" />
						{judge}:
					</span>
				)}
				<Coded text={text} />
			</span>
		</li>
	);
}

function elapsed(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds % 60}s`;
}

/** The card of the eval run card id `id` names, while the conversation holds it. */
function EvalRunLine({ id }: { id: string }): JSX.Element | null {
	const name = evalRunOfId(id);
	const { conversation, runs } = useContext(EvalRuns);
	const run = runs.find((each) => each.name === name);
	if (run === undefined) {
		return null;
	}
	return (
		<EvalLiveCard
			live={evalLiveOf(run)}
			{...(conversation === null || name === undefined
				? {}
				: { onCancel: () => cancelEval(conversation, name) })}
		/>
	);
}
