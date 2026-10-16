import { CheckIcon, CircleDotIcon, ListChecksIcon } from "lucide-react";
import { type JSX, type KeyboardEvent, type ReactNode, useState } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#dev/components/ui/tooltip.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Question } from "../plan";
import type { Answer } from "../reply";
import { CardBox } from "./card-box";
import { ChoiceBody, HowToPick, WhyLine, WhySwitch } from "./choice-body";
import type { Files } from "./files";
import { Markdown } from "./markdown";
import { Ranking } from "./question-ranking";

const UNANSWERED: Answer = { picks: [], words: "" };

export function QuestionCard({
	asked,
	answer,
	live,
	onAnswer,
	onNext,
	action,
	chosenLabel = "Recommended",
	roomy = false,
	files = null,
}: {
	asked: Question;
	/** Its answer, being written or sent; null while it has none. */
	answer: Answer | null;
	/** Whether it can still be answered. */
	live: boolean;
	onAnswer: (answer: Answer) => void;
	onNext: () => void;
	/** Beside its line, at the end: a way to put the card away. */
	action?: ReactNode;
	/** What tags the `(chosen)` choice: the agent's pick while it waits, or what it went with. */
	chosenLabel?: string;
	/**
	 * Sized for a finger, as the one question on a phone's screen: larger
	 * text and targets, a typed answer with room to grow, and no number,
	 * which the screen says.
	 */
	roomy?: boolean;
	/** Where what is attached to its answer goes; null where a reply carries none. */
	files?: Files | null;
}): JSX.Element {
	const { number, text, size, body, choices, pick } = asked;
	const said: Answer = answer ?? UNANSWERED;
	// The choice the arrows move from, and Tab lands on: the first picked.
	const [at, setAt] = useState(() =>
		Math.max(
			0,
			choices.findIndex((choice) => said.picks.includes(choice.key)),
		),
	);
	const [reasons, setReasons] = useState(false);
	const reasoned = choices.some((choice) => choice.why !== "");
	const toggle = (key: string) => {
		const on = said.picks.includes(key);
		onAnswer({
			...said,
			picks:
				pick === "any"
					? on
						? said.picks.filter((each) => each !== key)
						: [...said.picks, key].sort()
					: on
						? []
						: [key],
		});
	};
	const keys = (event: KeyboardEvent<HTMLFieldSetElement>) => {
		// A screenshot under a choice keeps its own keys.
		if (
			event.metaKey ||
			event.ctrlKey ||
			event.altKey ||
			!(event.target as HTMLElement).hasAttribute("aria-pressed")
		) {
			return;
		}
		const buttons = [
			...event.currentTarget.querySelectorAll<HTMLButtonElement>(
				"button[aria-pressed]",
			),
		];
		const to = (index: number) => {
			setAt(index);
			buttons[index]?.focus();
		};
		const lettered = choices.findIndex(
			(choice) => choice.key === event.key.toLowerCase(),
		);
		if (lettered !== -1) {
			event.preventDefault();
			toggle(choices[lettered]?.key as string);
			to(lettered);
		} else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const step = event.key === "ArrowDown" ? 1 : -1;
			to((at + step + choices.length) % choices.length);
		} else if (event.key === "Enter") {
			// Space picks the choice in focus; Enter moves on.
			event.preventDefault();
			onNext();
		}
	};
	const enter = (event: globalThis.KeyboardEvent) => {
		// Enter moves on; Shift+Enter is a new line.
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			onNext();
		}
	};
	return (
		<li
			aria-label={`question ${number}`}
			// Barred down its side while focus is inside it, so it is plain which
			// question the keys go to.
			className={cn(
				"relative flex gap-3",
				roomy
					? "px-5 pt-2 pb-5"
					: "px-4 py-4 transition-colors duration-150 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary before:opacity-0 before:transition-opacity before:duration-150 focus-within:bg-muted/40 focus-within:before:opacity-100",
			)}
		>
			{!roomy && (
				<span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-[11px] text-muted-foreground tabular-nums">
					{number}
					{answer !== null && <span className="sr-only"> answered</span>}
				</span>
			)}
			<div
				className={cn(
					"flex min-w-0 flex-1 flex-col",
					roomy ? "gap-4" : "gap-3",
				)}
			>
				<div className={cn("flex flex-col", roomy ? "gap-2" : "gap-1")}>
					<div className="flex items-start gap-2">
						<p
							className={cn(
								"flex-1 leading-snug",
								roomy ? "font-semibold text-lg" : "font-medium text-sm",
							)}
						>
							<Markdown text={text} inline />
						</p>
						{size !== null && <Size size={size} />}
						{action}
					</div>
					{body !== "" && (
						<Markdown
							text={body}
							className={cn(
								"text-muted-foreground leading-relaxed [&_p]:my-0",
								roomy ? "text-[15px]" : "text-[13px]",
							)}
						/>
					)}
				</div>
				{pick === "order" ? (
					<Ranking
						asked={asked}
						answer={said}
						live={live}
						roomy={roomy}
						onAnswer={onAnswer}
						onNext={onNext}
					/>
				) : (
					choices.length > 0 && (
						<fieldset
							aria-label={text}
							onKeyDown={keys}
							className={cn(
								"m-0 flex min-w-0 flex-col border-0 p-0",
								roomy ? "gap-2.5" : "gap-1.5",
							)}
						>
							<legend className="mb-1.5 flex w-full items-center justify-between gap-2">
								{pick === "any" ? (
									<HowToPick
										Icon={ListChecksIcon}
										text="Select all that apply"
									/>
								) : (
									<HowToPick Icon={CircleDotIcon} text="Pick one" />
								)}
								{reasoned && <WhySwitch on={reasons} onTurn={setReasons} />}
							</legend>
							{choices.map((choice, index) => {
								const on = said.picks.includes(choice.key);
								return (
									// Its body sits under it in the same frame, outside the
									// button, as a screenshot is a button of its own. Ringed on
									// any focus, not just a keyboard one, since a card that
									// comes up focuses its first choice itself.
									<div
										key={choice.key}
										className={cn(
											"group border transition-[background-color,border-color,box-shadow,transform] duration-150 has-[>button:active]:scale-[0.99]",
											// On a phone's screen, only a keyboard's focus, so the
											// choice focused as it comes up never reads as picked.
											roomy
												? "rounded-xl has-[>button:focus-visible]:ring-3 has-[>button:focus-visible]:ring-ring/40"
												: "rounded-lg has-[>button:focus]:ring-3 has-[>button:focus]:ring-ring/40",
											on
												? "border-primary/60 bg-primary/[0.04] shadow-xs ring-1 ring-primary/15"
												: "border-border/70 bg-background hover:border-border hover:bg-muted/50",
										)}
									>
										<button
											type="button"
											aria-pressed={on}
											disabled={!live}
											// One stop per question for Tab; the arrows and letters
											// move within it.
											tabIndex={index === at ? 0 : -1}
											data-stop={index === at ? number : undefined}
											onFocus={() => setAt(index)}
											onClick={() => toggle(choice.key)}
											// Where it is narrow, its badge wraps under its text rather
											// than squeezing it; a finger gets a taller choice.
											className={cn(
												"flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-left outline-none disabled:cursor-default",
												roomy
													? "min-h-14 rounded-xl px-4 py-3 text-base"
													: "rounded-lg px-3 py-2 text-sm pointer-coarse:py-3",
											)}
										>
											<span
												className={cn(
													"flex shrink-0 items-center justify-center border font-medium font-mono transition-colors duration-150",
													roomy ? "size-6 text-xs" : "size-5 text-[11px]",
													// A circle picks one, as a radio does; a square any.
													pick === "any" ? "rounded-sm" : "rounded-full",
													on
														? "border-primary bg-primary text-primary-foreground"
														: "bg-muted/60 text-muted-foreground group-hover:bg-background",
												)}
											>
												{choice.key}
											</span>
											<Markdown
												text={choice.text}
												inline
												unlinked
												// Roomy, a badge beside it wraps under rather than squeezing it.
												className={cn(
													"min-w-0 flex-1",
													roomy ? "basis-56" : "basis-32",
												)}
											/>
											{choice.chosen && <Chosen label={chosenLabel} />}
											<CheckIcon
												className={cn(
													"size-4 shrink-0 text-primary transition-[opacity,transform] duration-150",
													on ? "scale-100 opacity-100" : "scale-75 opacity-0",
												)}
											/>
										</button>
										<ChoiceBody body={choice.body} />
										{reasons && <WhyLine why={choice.why} />}
									</div>
								);
							})}
						</fieldset>
					)
				)}
				{live ? (
					<CardBox
						roomy={roomy}
						data-stop={choices.length === 0 ? number : undefined}
						aria-label={`Answer to ${number}`}
						value={said.words}
						placeholder={
							choices.length > 0 ? "Add a note (optional)" : "Your answer"
						}
						onValue={(words) => onAnswer({ ...said, words })}
						files={files}
						onKeyDown={enter}
						className={
							roomy
								? // A typed answer is the screen's whole point; a note an aside.
									choices.length === 0
									? "min-h-32"
									: "min-h-12"
								: "min-h-9 pointer-coarse:min-h-11"
						}
					/>
				) : (
					said.words !== "" && (
						<Markdown
							text={said.words}
							className="text-sm [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
						/>
					)
				)}
			</div>
		</li>
	);
}

/** What each size means, as the skill defines it, for the letter's hover. */
const SIZE_MEANINGS: Record<string, string> = {
	small: "stays local and is cheap to redo",
	medium: "shapes how a feature behaves or looks, or spans systems",
	large: "hard to undo or outward-facing",
};

/**
 * How far the call reaches, as the agent sized it: its first letter, quiet
 * beside the question, and on hover the size and what it means.
 */
function Size({ size }: { size: string }): JSX.Element {
	const word = size.charAt(0).toUpperCase() + size.slice(1);
	const meaning = SIZE_MEANINGS[size];
	const label =
		meaning === undefined ? `${word} call` : `${word} call: ${meaning}`;
	return (
		<Tooltip>
			<TooltipTrigger
				render={<span />}
				aria-label={label}
				className="mt-0.5 shrink-0 cursor-default rounded font-medium text-[11px] text-muted-foreground/70 tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				{word.charAt(0)}
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

/** Marks the choice the agent went with, while it waits for the reply or since. */
function Chosen({ label }: { label: string }): JSX.Element {
	return (
		<span className="shrink-0 rounded-full border px-1.5 py-px text-[11px] text-muted-foreground">
			{label}
		</span>
	);
}
