import type { StepProgress } from "@stringsync/splates-server/setup";
import { CheckIcon, TriangleAlertIcon } from "lucide-react";
import type { JSX } from "react";

interface StepNav {
	steps: readonly StepProgress[];
	/** The page shown, from 0. */
	at: number;
	working: boolean;
	/** Goes back to an earlier step, by index from 0. */
	onGo?: (index: number) => void;
}

/**
 * A thin bar of one segment per step over the page's title, "Step 3 of 9"
 * above it; an earlier segment goes back to its step.
 */
export function StepBar({
	steps,
	at,
	working,
	onGo,
	className = "",
}: StepNav & { className?: string }): JSX.Element {
	const fill: Record<StepTone, string> = {
		warning: "bg-warning",
		success: "bg-success",
		current: "bg-foreground",
		todo: "bg-muted-foreground/20",
	};
	return (
		<div className={`flex flex-col gap-2 ${className}`}>
			<span className="text-muted-foreground text-sm tabular-nums">
				Step {at + 1} of {steps.length}
			</span>
			<ol aria-label="step progress" className="flex gap-1">
				{steps.map((step, index) => {
					const back = onGo !== undefined && index < at;
					return (
						<li
							key={step.id}
							className="flex-1"
							aria-current={index === at ? "step" : undefined}
						>
							<button
								type="button"
								title={step.title}
								aria-label={step.title}
								disabled={!back || working}
								onClick={() => onGo?.(index)}
								className={`block h-1.5 w-full rounded-full ${fill[stepTone(step, index === at)]} enabled:cursor-pointer enabled:hover:opacity-70`}
							/>
						</li>
					);
				})}
			</ol>
		</div>
	);
}

/**
 * Every step down a line beside the page, on a wide screen; a phone shows
 * the bar over the title instead.
 */
export function StepRail({ steps, at, working, onGo }: StepNav): JSX.Element {
	return (
		<ol
			aria-label="steps"
			className="flex flex-col self-start text-sm max-md:hidden md:sticky md:top-4"
		>
			{steps.map((step, index) => {
				const here = index === at;
				const back = onGo !== undefined && index < at;
				const content = (
					<>
						<StepMark step={step} index={index} here={here} />
						<span
							className={`leading-5 ${here ? "font-medium" : "text-muted-foreground"}`}
						>
							{step.title}
						</span>
					</>
				);
				return (
					<li
						key={step.id}
						aria-current={here ? "step" : undefined}
						className="relative pb-4 last:pb-0"
					>
						{index < steps.length - 1 && (
							<span
								aria-hidden
								className={`absolute top-5 bottom-0 left-2.5 w-px -translate-x-1/2 ${step.status === "done" ? "bg-success/40" : "bg-border"}`}
							/>
						)}
						{back ? (
							<button
								type="button"
								disabled={working}
								className="flex cursor-pointer gap-3 text-left hover:underline disabled:cursor-default"
								onClick={() => onGo(index)}
							>
								{content}
							</button>
						) : (
							<span className="flex gap-3">{content}</span>
						)}
					</li>
				);
			})}
		</ol>
	);
}

/** The color a step's mark takes: warned, done, the page's own, or to come. */
type StepTone = "warning" | "success" | "current" | "todo";

function stepTone(step: StepProgress, here: boolean): StepTone {
	if (step.warning !== null) {
		return "warning";
	}
	if (step.status === "done") {
		return "success";
	}
	return here ? "current" : "todo";
}

/** A step's round mark: a check, a warning, or its number. */
function StepMark({
	step,
	index,
	here,
}: {
	step: StepProgress;
	index: number;
	here: boolean;
}): JSX.Element {
	const tone = stepTone(step, here);
	const ring: Record<StepTone, string> = {
		warning: "border-warning text-warning",
		success: "border-success text-success",
		current: "border-foreground bg-foreground text-background",
		todo: "text-muted-foreground",
	};
	return (
		<span
			aria-hidden
			className={`relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full border bg-background text-[10px] tabular-nums ${ring[tone]}`}
		>
			{tone === "warning" ? (
				<TriangleAlertIcon className="size-3" />
			) : tone === "success" ? (
				<CheckIcon className="size-3" />
			) : (
				index + 1
			)}
		</span>
	);
}
