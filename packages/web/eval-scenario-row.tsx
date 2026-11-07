import type { ConversationState } from "@splates/server/conversations";
import type {
	EvalScenario,
	EvalScenarioState,
	EvalScenarioStatus,
} from "@splates/server/evals/browser";
import type { AgentPick } from "@splates/server/models";
import { ChevronDownIcon, ChevronRightIcon, PlayIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Checkbox } from "#web/components/ui/checkbox.tsx";
import { cn } from "#web/lib/utils.ts";
import { loopLabel } from "./eval-loops";
import { ScenarioDetails } from "./eval-scenario-details";
import { STATE_LABEL, shortNameOf } from "./eval-scenarios";
import { ago } from "./plan-limits";

const STATE_TONE: Record<EvalScenarioStatus, string> = {
	failing: "bg-destructive/15 text-destructive",
	"never-run": "bg-muted text-muted-foreground",
	passing: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

/** One scenario in the table: pick it, open its details, run it or open its loop. */
export function EvalScenarioRow({
	scenario,
	state,
	isPicked,
	isOpen,
	loop,
	now,
	saved,
	onOpenBatch,
	onPick,
	onOpen,
	onOpenLoop,
}: {
	scenario: EvalScenario;
	state: EvalScenarioState;
	isPicked: boolean;
	isOpen: boolean;
	/** The conversation already working this scenario's loop, if any. */
	loop: ConversationState | undefined;
	now: number;
	saved: readonly AgentPick[];
	onOpenBatch: (batch: string) => void;
	onPick: () => void;
	onOpen: () => void;
	onOpenLoop: () => void;
}): JSX.Element {
	return (
		<>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-3.5 py-3 hover:bg-accent/30">
				<Checkbox
					aria-label={`Select ${scenario.id}`}
					checked={isPicked}
					onCheckedChange={() => onPick()}
				/>
				<div className="min-w-0 flex-1">
					<button
						type="button"
						aria-expanded={isOpen}
						aria-label={`Details of ${scenario.id}`}
						onClick={onOpen}
						className="flex items-center gap-1 text-left font-medium break-words"
					>
						{isOpen ? (
							<ChevronDownIcon className="size-3.5" />
						) : (
							<ChevronRightIcon className="size-3.5" />
						)}
						{shortNameOf(scenario.id)}
					</button>
					{scenario.about !== null && (
						<p
							className={cn(
								"mt-0.5 ml-[1.125rem] text-muted-foreground text-xs",
								!isOpen && "line-clamp-2",
							)}
						>
							{scenario.about}
						</p>
					)}
				</div>
				<span
					className={cn(
						"inline-flex h-5 items-center rounded-full px-2 font-medium text-xs whitespace-nowrap",
						STATE_TONE[state.state],
					)}
				>
					{STATE_LABEL[state.state]}
				</span>
				<span
					title={
						state.lastRunAt === null
							? undefined
							: new Date(state.lastRunAt).toLocaleString()
					}
					className="w-16 text-muted-foreground text-xs whitespace-nowrap"
				>
					{state.lastRunAt === null
						? "never"
						: ago(Date.parse(state.lastRunAt), now)}
				</span>
				{loop !== undefined && (
					<Button
						size="sm"
						variant="outline"
						className="min-h-9 md:min-h-8"
						aria-label={`Open loop for ${scenario.id}`}
						onClick={onOpenLoop}
					>
						<PlayIcon />
						{loopLabel(loop)}
					</Button>
				)}
			</div>
			{isOpen && (
				<div className="border-t bg-muted/30 px-3.5 py-3">
					<ScenarioDetails
						scenario={scenario}
						state={state}
						saved={saved}
						onOpenBatch={onOpenBatch}
					/>
				</div>
			)}
		</>
	);
}
