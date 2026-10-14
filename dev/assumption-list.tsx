import {
	CheckIcon,
	MessageSquareWarningIcon,
	RotateCwIcon,
	UndoIcon,
} from "lucide-react";
import {
	type JSX,
	type ReactNode,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#dev/components/ui/tooltip.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Question } from "../plan";
import { type Answer, answerIn, besides, isEmpty, replyOf } from "../reply";
import { Markdown } from "./markdown";
import { QuestionCard } from "./question-card";

/** The answer that leaves `assumed` as the agent took it: its `(chosen)` choices. */
export function takenOf(assumed: Question): Answer {
	return {
		picks: assumed.choices
			.filter((choice) => choice.chosen)
			.map((choice) => choice.key),
		words: "",
	};
}

/** Whether `answer` challenges `assumed`: says anything but what it took. */
function challenges(assumed: Question, answer: Answer): boolean {
	const taken = takenOf(assumed).picks;
	return (
		!isEmpty(answer) &&
		(answer.words.trim() !== "" ||
			answer.picks.length !== taken.length ||
			answer.picks.some((key) => !taken.includes(key)))
	);
}

/** What is written against a task's assumptions: each challenge by its line, and any words. */
interface Written {
	challenges: Record<string, Answer>;
	changes: string;
}

/** Whether two lists of assumptions say the same: their lines, choices and picks. */
function alike(one: Question[], other: Question[]): boolean {
	const said = (list: Question[]) =>
		JSON.stringify(
			list.map(({ number, text, body, choices }) => [
				number,
				text,
				body,
				choices.map(({ key, text, chosen }) => [key, text, chosen]),
			]),
		);
	return said(one) === said(other);
}

/**
 * `answer` to `before` moved onto `after`, the same assumption since
 * changed: each pick by its choice's text, as its letter may have moved.
 * Null when nothing of it is left.
 */
function carried(
	before: Question,
	after: Question,
	answer: Answer,
): Answer | null {
	const picks = answer.picks.flatMap((key) => {
		const text = before.choices.find((choice) => choice.key === key)?.text;
		const now = after.choices.find((choice) => choice.text === text);
		return now === undefined ? [] : [now.key];
	});
	const moved = { picks, words: answer.words };
	return challenges(after, moved) ? moved : null;
}

/**
 * The challenges written against a task's assumptions, `live` as its plan
 * says them now, with any words besides, kept in `kept` as the reply they
 * make, so leaving and coming back loses nothing. Once a challenge is
 * written, the assumptions shown hold still, so nothing moves under the
 * person; `changed` says the plan has moved on, and `reload` takes it up,
 * carrying each challenge whose assumption is still there.
 */
export function useChallenges(
	live: Question[],
	kept: { read(): string; write(text: string): void },
): {
	/** The assumptions shown: as the plan says them, or as they were when the first challenge was written. */
	assumptions: Question[];
	/** The challenge written to each, by position; null for none. */
	answers: (Answer | null)[];
	changes: string;
	setChanges: (text: string) => void;
	/** Writes `answer` to `assumed`; one that says only what it took withdraws the challenge. */
	challenge: (assumed: Question, answer: Answer) => void;
	/** All of it as a reply, quoting each challenged line; empty for none. */
	reply: string;
	/** Drops everything written, once it is sent. */
	clear: () => void;
	/** Whether the plan's assumptions moved on from those shown. */
	changed: boolean;
	/** How many challenges `reload` would drop, their assumptions gone. */
	dropped: number;
	/** Shows the plan's assumptions as they are now. */
	reload: () => void;
} {
	const [written, setWritten] = useState((): Written => {
		const before = kept.read();
		return {
			challenges: Object.fromEntries(
				live.flatMap((asked) => {
					const answer = answerIn(before, asked);
					return answer === null || !challenges(asked, answer)
						? []
						: [[asked.text, answer]];
				}),
			),
			changes: besides(before, live),
		};
	});
	const [held, setHeld] = useState<Question[] | null>(() =>
		Object.keys(written.challenges).length === 0 ? null : live,
	);
	const shown = held ?? live;
	const replyFrom = (list: Question[], { challenges: by, changes }: Written) =>
		replyOf(
			list,
			list.map((asked) => by[asked.text] ?? null),
			changes,
		).trim();
	const write = (list: Question[], next: Written) => {
		setWritten(next);
		setHeld(Object.keys(next.challenges).length === 0 ? null : list);
		kept.write(replyFrom(list, next));
	};
	const lines = new Set(live.map((asked) => asked.text));
	return {
		assumptions: shown,
		answers: shown.map((asked) => written.challenges[asked.text] ?? null),
		changes: written.changes,
		setChanges: (changes) => write(shown, { ...written, changes }),
		challenge: (assumed, answer) => {
			const rest = Object.fromEntries(
				Object.entries(written.challenges).filter(
					([text]) => text !== assumed.text,
				),
			);
			write(shown, {
				...written,
				challenges: challenges(assumed, answer)
					? { ...rest, [assumed.text]: answer }
					: rest,
			});
		},
		reply: replyFrom(shown, written),
		clear: () => write(live, { challenges: {}, changes: "" }),
		changed: held !== null && !alike(held, live),
		dropped: Object.keys(written.challenges).filter((text) => !lines.has(text))
			.length,
		reload: () =>
			write(live, {
				...written,
				challenges: Object.fromEntries(
					live.flatMap((after) => {
						const before = shown.find((asked) => asked.text === after.text);
						const answer = written.challenges[after.text];
						const moved =
							before === undefined || answer === undefined
								? null
								: carried(before, after, answer);
						return moved === null ? [] : [[after.text, moved]];
					}),
				),
			}),
	};
}

/**
 * Says, in the actions beside Send or Merge, that the agent changed its
 * assumptions since the person started challenging them, reassures them
 * their challenges carry over to those still there, and offers to show them
 * as they are now.
 */
export function AssumptionsChanged({
	dropped,
	onReload,
	className,
}: {
	dropped: number;
	onReload: () => void;
	className?: string;
}): JSX.Element {
	return (
		<p
			role="status"
			className={cn("flex min-w-0 items-center gap-2 text-xs", className)}
		>
			<span className="min-w-0 flex-1">
				<span className="font-medium">Assumptions changed.</span>{" "}
				<span className="text-muted-foreground">
					{dropped === 0
						? "Reloading keeps your challenges."
						: `Reloading keeps your challenges to those still there, and drops ${dropped === 1 ? "the one" : dropped} now gone.`}
				</span>
			</span>
			<Button size="xs" variant="outline" onClick={onReload}>
				<RotateCwIcon data-icon="inline-start" />
				Reload
			</Button>
		</p>
	);
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
	heading = true,
	whole = false,
	onAnswer,
	onNext,
	onChallenge,
}: {
	assumptions: Question[];
	answers: (Answer | null)[];
	/** Whether a challenge can still be written. */
	live: boolean;
	/** Whether it titles itself, rather than sitting under a card's title. */
	heading?: boolean;
	/**
	 * Whether each shows whole, what it asked over the choice taken, rather
	 * than on one line cut to fit.
	 */
	whole?: boolean;
	onAnswer: (assumed: Question, answer: Answer) => void;
	/** Once Enter is pressed in an open challenge. */
	onNext: () => void;
	/**
	 * Challenges an assumption somewhere else, such as a dialog, rather than
	 * opening it in place.
	 */
	onChallenge?: (number: string) => void;
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
		<section
			aria-label="Assumptions"
			className="@container flex flex-col py-1.5"
		>
			{heading && (
				<h3 className="flex items-center gap-1.5 px-4 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">
					Assumptions
				</h3>
			)}
			<ol className="flex flex-col">
				{assumptions.map((assumed, at) => {
					const answer = answers[at] ?? null;
					const open =
						onChallenge === undefined &&
						(opened.has(assumed.number) || answer !== null);
					return open ? (
						<ChallengeCard
							key={assumed.number}
							assumed={assumed}
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
											onAnswer(assumed, takenOf(assumed));
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
							challenge={answer}
							live={live}
							whole={whole}
							onChallenge={() =>
								onChallenge === undefined
									? toggle(assumed.number, true)
									: onChallenge(assumed.number)
							}
						/>
					);
				})}
			</ol>
		</section>
	);
}

/**
 * An assumption as a question card: every choice offered, the one the agent
 * took tagged Assumed and picked until another is. Picking it again
 * withdraws the challenge.
 */
export function ChallengeCard({
	assumed,
	answer,
	...card
}: {
	assumed: Question;
	/** The challenge written to it; null for none. */
	answer: Answer | null;
	live: boolean;
	onAnswer: (answer: Answer) => void;
	onNext: () => void;
	action?: ReactNode;
}): JSX.Element {
	return (
		<QuestionCard
			{...card}
			asked={assumed}
			answer={answer ?? takenOf(assumed)}
			chosenLabel="Assumed"
		/>
	);
}

/**
 * One assumption: what it asked, then what the agent took, on one line cut
 * to fit, or `whole`, the choice taken under what it asked.
 */
function AssumptionRow({
	assumed,
	challenge,
	live,
	whole,
	onChallenge,
}: {
	assumed: Question;
	/** The challenge written to it, shown in place of what it took; null for none. */
	challenge: Answer | null;
	live: boolean;
	whole: boolean;
	onChallenge: () => void;
}): JSX.Element {
	const { number, text, choices } = assumed;
	const taken = choices.filter((choice) => choice.chosen);
	const picked = choices.filter((choice) =>
		challenge?.picks.includes(choice.key),
	);
	// The challenge written, in place of what it took.
	const shown =
		challenge !== null
			? picked.length > 0
				? picked.map((choice) => choice.text).join(", ")
				: challenge.words
			: taken.length > 0
				? taken.map((choice) => choice.text).join(", ")
				: null;
	const mark =
		challenge !== null ? (
			<MessageSquareWarningIcon
				role="img"
				aria-label="challenged"
				className="size-3.5 shrink-0"
			/>
		) : (
			<CheckIcon className="size-3.5 shrink-0 text-success" />
		);
	const numeral = (
		<span className="w-5 shrink-0 text-center font-semibold text-[11px] text-muted-foreground tabular-nums">
			{number}
		</span>
	);
	const button = live && (
		<Button
			variant="ghost"
			size="xs"
			aria-label={`Challenge assumption ${number}`}
			// Its name, for where it shows as an icon alone.
			title="Challenge"
			onClick={onChallenge}
			className="shrink-0 text-muted-foreground"
		>
			<MessageSquareWarningIcon data-icon="inline-start" />
			<span className="hidden @sm:inline">Challenge</span>
		</Button>
	);
	if (whole) {
		return (
			<li
				aria-label={`assumption ${number}`}
				className="flex items-start gap-2 px-4 py-1.5 text-sm"
			>
				<span className="flex h-6 items-center">{numeral}</span>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
					<Markdown text={text} inline className="text-muted-foreground" />
					{shown !== null && (
						<span
							className={cn(
								"flex items-start gap-1 font-medium",
								challenge !== null && "text-warning",
							)}
						>
							<span className="flex h-5 items-center">{mark}</span>
							<Markdown text={shown} inline />
						</span>
					)}
				</div>
				{button}
			</li>
		);
	}
	return (
		<li
			aria-label={`assumption ${number}`}
			// One line where there is room; in a narrow column, what it asked
			// over the choice taken.
			className="flex min-h-8 flex-wrap items-center gap-x-2 px-4 py-0.5 text-sm"
		>
			<span className="flex min-w-0 basis-full items-center gap-2 @sm:flex-1 @sm:basis-0">
				{numeral}
				<Clipped text={text} className="flex-1 text-muted-foreground" />
			</span>
			{shown !== null && (
				<span
					className={cn(
						"flex min-w-0 flex-1 items-center gap-1 pl-7 font-medium @sm:max-w-1/2 @sm:flex-none @sm:pl-0",
						challenge !== null && "text-warning",
					)}
				>
					{mark}
					<Clipped text={shown} />
				</span>
			)}
			{button}
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
