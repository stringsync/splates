import { CheckIcon, MessageSquareWarningIcon, UndoIcon } from "lucide-react";
import { type JSX, useLayoutEffect, useRef, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#dev/components/ui/tooltip.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Question } from "../plan";
import type { Answer } from "../reply";
import { Markdown } from "./markdown";
import { QuestionCard } from "./question-card";

/**
 * What challenging `assumed` asks: its line, what the agent took, and the
 * choices it passed over. A reply quotes its line, as it would a question's,
 * so the agent can match it whether it is still an assumption or has moved
 * to `## Blocked`.
 */
export function challengeOf(assumed: Question): Question {
	const taken = assumed.choices.filter((choice) => choice.chosen);
	return {
		...assumed,
		body: [
			taken.length === 0
				? ""
				: `Assumed ${taken.map((choice) => choice.text).join(", ")}.`,
			assumed.body,
		]
			.filter((part) => part !== "")
			.join("\n\n"),
		choices: assumed.choices.filter((choice) => !choice.chosen),
	};
}

/**
 * A task's assumptions, a line each: what it asked and the choice the agent
 * took, with a Challenge control that opens it as a question card offering
 * the rest, and Keep to put that away again. `answers` are the challenges
 * written, by position.
 */
export function AssumptionList({
	assumptions,
	answers,
	live,
	onAnswer,
	onNext,
}: {
	assumptions: Question[];
	answers: (Answer | null)[];
	/** Whether a challenge can still be written. */
	live: boolean;
	onAnswer: (assumed: Question, answer: Answer) => void;
	/** Once Enter is pressed in an open challenge. */
	onNext: () => void;
}): JSX.Element {
	// Open with a challenge already written, as from a kept draft.
	const [opened, setOpened] = useState(
		() =>
			new Set(
				assumptions
					.filter((_, at) => answers[at] != null)
					.map((assumed) => assumed.number),
			),
	);
	const toggle = (number: string, open: boolean) =>
		setOpened((before) => {
			const after = new Set(before);
			if (open) {
				after.add(number);
			} else {
				after.delete(number);
			}
			return after;
		});
	return (
		<section aria-label="Assumptions" className="flex flex-col py-1.5">
			<h3 className="flex items-center gap-1.5 px-4 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">
				Assumptions
			</h3>
			<ol className="flex flex-col">
				{assumptions.map((assumed, at) => {
					const answer = answers[at] ?? null;
					return opened.has(assumed.number) || answer !== null ? (
						<QuestionCard
							key={assumed.number}
							asked={challengeOf(assumed)}
							answer={answer}
							live={live}
							onAnswer={(next) => onAnswer(assumed, next)}
							onNext={onNext}
							action={
								live && (
									<Button
										variant="ghost"
										size="xs"
										aria-label={`Keep assumption ${assumed.number}`}
										onClick={() => {
											onAnswer(assumed, { picks: [], words: "" });
											toggle(assumed.number, false);
										}}
										className="shrink-0 text-muted-foreground"
									>
										<UndoIcon data-icon="inline-start" />
										Keep
									</Button>
								)
							}
						/>
					) : (
						<AssumptionRow
							key={assumed.number}
							assumed={assumed}
							live={live}
							onChallenge={() => toggle(assumed.number, true)}
						/>
					);
				})}
			</ol>
		</section>
	);
}

/** One assumption on one line: what it asked, then what the agent took. */
function AssumptionRow({
	assumed,
	live,
	onChallenge,
}: {
	assumed: Question;
	live: boolean;
	onChallenge: () => void;
}): JSX.Element {
	const { number, text, choices } = assumed;
	const taken = choices.filter((choice) => choice.chosen);
	return (
		<li
			aria-label={`assumption ${number}`}
			className="group/row flex min-h-8 items-center gap-2 px-4 py-0.5 text-sm"
		>
			<span className="w-5 shrink-0 text-center font-semibold text-[11px] text-muted-foreground tabular-nums">
				{number}
			</span>
			<Clipped text={text} className="flex-1 text-muted-foreground" />
			{taken.length > 0 && (
				<span className="flex max-w-1/2 shrink-0 items-center gap-1 font-medium">
					<CheckIcon className="size-3.5 shrink-0 text-success" />
					<Clipped text={taken.map((choice) => choice.text).join(", ")} />
				</span>
			)}
			{live && (
				<Button
					variant="ghost"
					size="xs"
					aria-label={`Challenge assumption ${number}`}
					onClick={onChallenge}
					className="shrink-0 text-muted-foreground"
				>
					<MessageSquareWarningIcon data-icon="inline-start" />
					Challenge
				</Button>
			)}
		</li>
	);
}

/**
 * `text` on one line, cut off with "…" when it is too long, and then shown
 * whole on hover.
 */
function Clipped({
	text,
	className,
}: {
	text: string;
	className?: string;
}): JSX.Element {
	const [cut, setCut] = useState(false);
	const shown = useRef<HTMLSpanElement>(null);
	// Measured whenever its width changes, so the tooltip is ready before the
	// pointer arrives.
	useLayoutEffect(() => {
		const element = shown.current;
		if (element === null) {
			return;
		}
		const measure = () => setCut(element.scrollWidth > element.clientWidth);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return (
		<Tooltip disabled={!cut}>
			<TooltipTrigger
				render={<span ref={shown} />}
				className={cn("min-w-0 truncate", className)}
			>
				<Markdown text={text} inline />
			</TooltipTrigger>
			<TooltipContent className="max-w-sm">
				<Markdown text={text} inline />
			</TooltipContent>
		</Tooltip>
	);
}
