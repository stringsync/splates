import type { Answer, Question } from "@splates/server/plans";
import { isEmpty } from "@splates/server/plans/browser";
import { CheckIcon, ChevronRightIcon, ShieldCheckIcon } from "lucide-react";
import type { JSX } from "react";
import { Card, CardList } from "#web/components/ui/card.tsx";
import { cn } from "#web/lib/utils.ts";
import { CardBox } from "./card-box";
import type { Files } from "./files";
import { Markdown } from "./markdown";
import { type PlanChoice, planDecisionSummary } from "./plan-decision";

/**
 * The shared Review & send step used on both mobile sheets and desktop stepped
 * cards: an optional highlighted plan decision card on top (a tap from changing
 * it), one grouped list of questions with their picked answers (each a tap from
 * jumping back), and a compact "Anything else?" note box below.
 */
export function AnythingElsePage({
	questions,
	answers,
	decision = null,
	more,
	onMore,
	onSubmit,
	files,
	roomy = false,
	onTurn,
}: {
	questions: Question[];
	/** What is written to each question, by position; null for nothing. */
	answers: (Answer | null)[];
	/** Plan decision summary when reviewing a plan card; null for ordinary questions. */
	decision?: {
		choice: PlanChoice | null;
		review?: boolean;
		archive?: boolean;
		unanswered: boolean;
		onChange: () => void;
	} | null;
	more: string;
	onMore: (more: string) => void;
	/** Called when pressing Enter (without Shift) in the note box on desktop. */
	onSubmit?: () => void;
	/** What is attached to "Anything else", where the reply can carry files. */
	files: Files | null;
	/** Sized for touch targets when rendered inside a phone sheet. */
	roomy?: boolean;
	/** Goes back to the question at `at`. */
	onTurn: (at: number) => void;
}): JSX.Element {
	const picked =
		decision !== null &&
		decision.choice !== null &&
		!(decision.choice !== "revise" && decision.unanswered)
			? decision.choice
			: null;
	const meta =
		picked === null
			? null
			: planDecisionSummary(picked, {
					review: decision?.review,
					archive: decision?.archive,
				});
	return (
		<section
			aria-label="anything else"
			className="flex flex-col gap-3.5 px-4 py-4"
		>
			{decision !== null && (
				<button
					type="button"
					onClick={decision.onChange}
					aria-label={
						meta !== null
							? `Plan decision: ${meta.title}. Change`
							: "Choose plan decision"
					}
					className={cn(
						"flex w-full cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 text-left outline-none transition-[border-color,background-color] focus-visible:ring-3 focus-visible:ring-ring/40",
						meta === null
							? "border-warning/35 bg-warning/[0.06] hover:border-warning/50"
							: meta.accent
								? "border-success/30 bg-success/[0.055] hover:border-success/50"
								: "border-border bg-card hover:border-foreground/25",
					)}
				>
					<span
						className={cn(
							"flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
							meta === null
								? "bg-warning/15 text-warning"
								: meta.accent
									? "bg-success/15 text-success"
									: "bg-muted text-foreground",
						)}
					>
						{meta === null ? <ShieldCheckIcon /> : meta.icon}
					</span>
					<span className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="font-medium text-sm">
							{meta === null ? "Choose a decision" : meta.title}
						</span>
						<span className="truncate text-muted-foreground text-xs">
							{meta === null
								? decision.unanswered
									? "Answer every question before approving"
									: "Pick how to proceed before sending"
								: meta.detail}
						</span>
					</span>
					<span className="shrink-0 rounded-md border bg-background/60 px-2.5 py-1 font-medium text-muted-foreground text-xs">
						{meta === null ? "Choose" : "Change"}
					</span>
				</button>
			)}
			{questions.length > 0 && (
				<Card>
					<CardList render={<ol />} aria-label="your answers">
						{questions.map((asked, at) => {
							const preview = answerPreview(asked, answers[at] ?? null);
							return (
								<li key={asked.number}>
									<button
										type="button"
										onClick={() => onTurn(at)}
										className="flex min-h-12 w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/50 active:bg-muted"
									>
										<span className="flex min-w-0 flex-1 flex-col gap-0.5">
											<span
												className={cn(
													"truncate",
													preview === null
														? "text-foreground text-sm"
														: "text-muted-foreground text-xs",
												)}
											>
												<Markdown text={asked.text} inline unlinked />
											</span>
											{preview !== null && (
												<span className="truncate font-medium text-foreground text-sm">
													{preview}
												</span>
											)}
										</span>
										{preview === null ? (
											<span className="shrink-0 text-muted-foreground text-xs">
												Not answered
											</span>
										) : (
											<CheckIcon
												aria-label="answered"
												className="size-4 shrink-0 text-success"
											/>
										)}
										<ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
									</button>
								</li>
							);
						})}
					</CardList>
				</Card>
			)}
			<div className="flex flex-col gap-2">
				<p className="font-medium text-sm leading-snug">Anything else?</p>
				<CardBox
					roomy={roomy}
					data-stop="more"
					aria-label="Anything else"
					value={more}
					placeholder="Optional note…"
					onValue={onMore}
					files={files}
					onKeyDown={
						onSubmit === undefined
							? undefined
							: (event) => {
									// Enter sends, as in the composer; Shift+Enter is a new line.
									if (event.key === "Enter" && !event.shiftKey) {
										event.preventDefault();
										onSubmit();
									}
								}
					}
					className={roomy ? "min-h-12" : "min-h-9 pointer-coarse:min-h-11"}
				/>
			</div>
		</section>
	);
}

/** One-line summary of a question's answer for the grouped review list. */
function answerPreview(asked: Question, answer: Answer | null): string | null {
	if (answer === null || isEmpty(answer)) {
		return null;
	}
	const picks = answer.picks
		.map(
			(key) => asked.choices.find((choice) => choice.key === key)?.text ?? key,
		)
		.filter((text) => text !== "");
	const words = answer.words.trim();
	const picked = picks.join(asked.pick === "order" ? " → " : ", ");
	if (picked !== "" && words !== "") {
		return `${picked} · ${words}`;
	}
	return picked !== "" ? picked : words;
}
