import type { ConversationState } from "@splates/server/conversations";
import type {
	EvalScenario,
	EvalScenarioState,
} from "@splates/server/evals/browser";
import { CheckIcon, CircleDashedIcon, PlayIcon, XIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Checkbox } from "#web/components/ui/checkbox.tsx";
import { cn } from "#web/lib/utils.ts";
import { loopLabel } from "./eval-loops";
import { EvalChecks, EvalEnvironment, EvalExample } from "./eval-proposal-card";
import { needsRunsCount, passRateOf, titleOf } from "./eval-scenarios";
import { Markdown } from "./markdown";
import { ago } from "./plan-limits";

/**
 * One spec in the list: its sentence and pass rate, picked with its checkbox.
 * Opening it shows what the spec is, as its proposal card drew it, with a
 * link to its latest batch's test page.
 */
export function EvalScenarioRow({
	scenario,
	state,
	isPicked,
	isOpen,
	loop,
	now,
	onPick,
	onOpen,
	onOpenLoop,
}: {
	scenario: EvalScenario;
	state: EvalScenarioState;
	isPicked: boolean;
	isOpen: boolean;
	/** The conversation already working this spec's loop, if any. */
	loop: ConversationState | undefined;
	now: number;
	onPick: () => void;
	onOpen: () => void;
	onOpenLoop: () => void;
}): JSX.Element {
	const title = titleOf(scenario);
	const rate = passRateOf(state);
	return (
		<>
			<div
				className={cn(
					"flex items-center gap-x-2.5 border-t py-2 pr-3.5 hover:bg-accent/30",
					"pl-3.5",
					isOpen && "bg-muted/30",
				)}
			>
				<Checkbox
					aria-label={`Select ${title}`}
					checked={isPicked}
					onCheckedChange={() => onPick()}
				/>
				<button
					type="button"
					aria-expanded={isOpen}
					aria-label={title}
					onClick={onOpen}
					className="flex min-w-0 flex-1 items-center gap-2.5 text-left text-sm"
				>
					<StateMark state={state} />
					<Markdown text={title} inline unlinked />
				</button>
				{state.state === "needs-runs" ? (
					<span className="flex shrink-0 flex-col items-end text-right text-warning text-xs leading-tight tabular-nums whitespace-nowrap sm:flex-row sm:gap-1">
						<span>needs runs</span>
						<span>
							<span aria-hidden className="hidden sm:inline">
								·{" "}
							</span>
							{needsRunsCount(state)}
						</span>
					</span>
				) : (
					<span className="text-muted-foreground text-xs tabular-nums whitespace-nowrap">
						{rate === null ? "not run" : `${rate}%`}
					</span>
				)}
				{loop !== undefined && (
					<Button
						size="sm"
						variant="outline"
						className="min-h-9 md:min-h-8"
						aria-label={`Open loop for ${title}`}
						onClick={onOpenLoop}
					>
						<PlayIcon />
						{loopLabel(loop)}
					</Button>
				)}
			</div>
			{isOpen && <SpecDetail scenario={scenario} state={state} now={now} />}
		</>
	);
}

function StateMark({ state }: { state: EvalScenarioState }): JSX.Element {
	if (state.state === "failing") {
		return (
			<XIcon
				aria-label="failing"
				className="size-4 shrink-0 text-destructive"
			/>
		);
	}
	if (state.state === "needs-runs") {
		return (
			<CircleDashedIcon
				aria-label="needs runs"
				className="size-4 shrink-0 text-warning"
			/>
		);
	}
	if (state.state === "passing") {
		return (
			<CheckIcon
				aria-label="passing"
				className="size-4 shrink-0 text-success"
			/>
		);
	}
	return <span aria-hidden className="size-4 shrink-0" />;
}

/**
 * What an opened spec shows, drawn with the proposal card's own sections: its
 * environment, its example (the prompt and any sketched good reply) and its
 * checks, then a link to its runs on the test page and when it last ran.
 */
function SpecDetail({
	scenario,
	state,
	now,
}: {
	scenario: EvalScenario;
	state: EvalScenarioState;
	now: number;
}): JSX.Element {
	const checks = (scenario.checks ?? []).map((check) => check.about);
	return (
		<div
			className={cn(
				"flex flex-col gap-4 bg-muted/30 pt-1 pr-3.5 pb-3.5 text-[15px] text-foreground leading-relaxed",
				"pl-[3.75rem]",
			)}
		>
			{scenario.environment !== undefined && (
				<EvalEnvironment text={scenario.environment} />
			)}
			{scenario.prompt !== undefined && (
				<EvalExample message={scenario.prompt} turns={scenario.example ?? []} />
			)}
			<EvalChecks
				checks={checks}
				judge={scenario.judge ?? null}
				judgedBy={scenario.judgeWith ?? null}
			/>
			<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t pt-3 text-[12.5px]">
				{state.batch != null && (
					<a
						className="text-info"
						href={testAddress(state.batch, scenario.id, state.run)}
					>
						All runs on its test page ›
					</a>
				)}
				<span className="text-muted-foreground">
					{state.lastRunAt === null
						? "Not run yet."
						: `Last run ${ago(Date.parse(state.lastRunAt), now)}`}
				</span>
			</div>
		</div>
	);
}

/** The test page of a spec in its latest batch, on the run to open there. */
function testAddress(batch: string, id: string, run: string | null): string {
	return `#evals/${encodeURIComponent(batch)}/test/${encodeURIComponent(id)}${run === null ? "" : `/${encodeURIComponent(run)}`}`;
}
