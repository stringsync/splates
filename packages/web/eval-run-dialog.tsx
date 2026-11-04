import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Checkbox } from "#web/components/ui/checkbox.tsx";
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

/**
 * The run card for scenarios picked here: the saved agents ticked, the
 * repetitions, and a Start that opens a conversation for each to work its loop.
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
	onStart: (agents: string[], reps: number) => void;
}): JSX.Element {
	const [off, setOff] = useState<string[]>([]);
	const [reps, setReps] = useState(DEFAULT_REPS);
	const chosen = targets.filter((each) => !off.includes(each));
	return (
		<Dialog open={ids !== null} onOpenChange={(now) => !now && onCancel()}>
			<DialogContent showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>
						{ids?.length === 1
							? `Run ${ids[0]}`
							: `Run ${ids?.length} scenarios`}
					</DialogTitle>
					<DialogDescription>
						Each scenario gets its own conversation, told to run it and work its
						loop. The agent asks for the paid run with a run card.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-2">
					{targets.map((each) => (
						<div key={each} className="flex items-center gap-2 text-sm">
							<Checkbox
								aria-label={`Run on ${each}`}
								checked={!off.includes(each)}
								onCheckedChange={(on) =>
									setOff((now) =>
										on ? now.filter((one) => one !== each) : [...now, each],
									)
								}
							/>
							{each}
						</div>
					))}
					<label className="flex items-center gap-2 text-sm">
						Repetitions
						<input
							type="number"
							min={1}
							value={reps}
							onChange={(event) =>
								setReps(Math.max(1, Number(event.currentTarget.value) || 1))
							}
							className="h-8 w-16 rounded-md border bg-background px-2"
						/>
					</label>
				</div>
				<DialogFooter>
					<DialogClose render={<Button variant="outline" />}>
						Cancel
					</DialogClose>
					<Button
						disabled={targets.length > 0 && chosen.length === 0}
						onClick={() => onStart(chosen, reps)}
					>
						Start
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
