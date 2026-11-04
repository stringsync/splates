import {
	DEFAULT_EVAL_BUDGET,
	type EvalBudget,
} from "@splates/server/evals/browser";
import { CheckIcon, FlaskConicalIcon, PlayIcon } from "lucide-react";
import { type ComponentProps, type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";

/** Repetitions a run card starts with, as the loop's first round does. */
export const DEFAULT_REPS = 3;

/** What the dialog's Run hands back: the agents left on, the repetitions and the loop's limits. */
export type RunChoice = {
	agents: string[];
	reps: number;
	limits: EvalBudget;
};

/**
 * The run card for scenarios picked on the Evals page, the same card an agent
 * asks with: the scenarios, the saved agents to run on (tap one to leave it
 * out), the repetitions, the dollar budget and the round cap. Run is the
 * approval, so the conversation it opens for each scenario starts the loop
 * within those limits without asking again.
 */
export function RunDialog({
	ids,
	targets,
	onCancel,
	onStart,
}: {
	ids: string[] | null;
	targets: string[];
	onCancel: () => void;
	onStart: (choice: RunChoice) => void;
}): JSX.Element {
	const [off, setOff] = useState<string[]>([]);
	const [reps, setReps] = useState(DEFAULT_REPS);
	const [limits, setLimits] = useState<EvalBudget>({ ...DEFAULT_EVAL_BUDGET });
	const chosen = targets.filter((each) => !off.includes(each));
	return (
		<Dialog open={ids !== null} onOpenChange={(now) => !now && onCancel()}>
			<DialogContent showCloseButton={false}>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<FlaskConicalIcon aria-hidden className="size-4" />
						{ids?.length === 1
							? `Run ${ids[0]}`
							: `Run ${ids?.length} scenarios`}
					</DialogTitle>
					<DialogDescription>
						Each scenario gets its own conversation, which runs it and works its
						loop within the budget below. Run is your go-ahead: the agent does
						not ask again.
					</DialogDescription>
				</DialogHeader>
				<section
					aria-label="scenarios"
					className="flex flex-wrap gap-x-2 gap-y-0.5 text-muted-foreground text-xs"
				>
					{(ids ?? []).map((id) => (
						<code key={id} className="text-foreground">
							{id}
						</code>
					))}
				</section>
				<fieldset aria-label="agents" className="flex flex-col gap-2 text-sm">
					<legend className="mb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
						Run on
					</legend>
					<div className="flex flex-wrap items-center gap-2">
						{targets.map((each) => {
							const on = !off.includes(each);
							return (
								<label
									key={each}
									className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring ${on ? "border-primary/50 bg-primary/10 text-foreground" : "text-muted-foreground opacity-70 hover:opacity-100"}`}
								>
									<input
										type="checkbox"
										aria-label={`Run on ${each}`}
										className="sr-only"
										checked={on}
										onChange={() =>
											setOff((now) =>
												on ? [...now, each] : now.filter((one) => one !== each),
											)
										}
									/>
									{on ? (
										<CheckIcon aria-hidden className="size-3" />
									) : (
										<span aria-hidden className="size-3" />
									)}
									{each}
								</label>
							);
						})}
					</div>
				</fieldset>
				<fieldset
					aria-label="run settings"
					className="grid grid-cols-3 gap-2 text-xs"
				>
					<SettingField
						label="Repetitions"
						aria-label="Run repetitions"
						min={1}
						value={reps}
						onChange={(event) =>
							setReps(Math.max(1, Number(event.currentTarget.value) || 1))
						}
					/>
					<SettingField
						label="Budget ($)"
						aria-label="Budget in dollars"
						min={0.01}
						step="any"
						value={limits.usd}
						onChange={(event) =>
							setLimits({
								...limits,
								usd: Number(event.currentTarget.value) || 0,
							})
						}
					/>
					<SettingField
						label="Max rounds"
						aria-label="Max rounds"
						min={1}
						step={1}
						value={limits.rounds}
						onChange={(event) =>
							setLimits({
								...limits,
								rounds: Math.max(1, Number(event.currentTarget.value) || 1),
							})
						}
					/>
				</fieldset>
				<DialogFooter>
					<DialogClose render={<Button variant="outline" />}>
						Cancel
					</DialogClose>
					<Button
						className="gap-1.5"
						disabled={
							(targets.length > 0 && chosen.length === 0) || limits.usd <= 0
						}
						onClick={() => onStart({ agents: chosen, reps, limits })}
					>
						<PlayIcon data-icon="inline-start" />
						Run
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function SettingField({
	label,
	...input
}: { label: string } & ComponentProps<"input">): JSX.Element {
	return (
		<label className="flex flex-col gap-1 text-muted-foreground">
			{label}
			<input
				{...input}
				type="number"
				className="w-full rounded-md border bg-background px-2 py-1.5 text-foreground text-sm tabular-nums"
			/>
		</label>
	);
}
