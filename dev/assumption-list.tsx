import {
	CheckIcon,
	ChevronRightIcon,
	MessageSquareWarningIcon,
	RotateCwIcon,
	UndoIcon,
} from "lucide-react";
import { type JSX, type ReactNode, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#dev/components/ui/collapsible.tsx";
import { cn } from "#dev/lib/utils.ts";
import { shownIn } from "../exhibit";
import type { Question } from "../plan";
import {
	type Answer,
	answerIn,
	besides,
	challenges,
	replyOf,
	takenOf,
} from "../reply";
import { Markdown } from "./markdown";
import { QuestionCard } from "./question-card";

/**
 * A task's assumptions, by number, each under the exhibit its body shows,
 * if any, those beside each other sharing one. With no exhibit among them,
 * and not `bare`, they are closed until opened under a title that counts
 * them, and held open while any is challenged, so a challenge written never
 * hides. `bare` lists them with no title, open, where their card's own
 * title already says them.
 * Each is what it asked over the choice the agent took, with a Challenge
 * control that opens it as a question card offering the rest, and Keep to
 * put that away again. `answers` are the challenges written, by position.
 */
export function AssumptionList({
	assumptions,
	answers,
	live,
	unfolded: open = false,
	bare = false,
	onAnswer,
	onNext,
}: {
	assumptions: Question[];
	answers: (Answer | null)[];
	/** Whether a challenge can still be written. */
	live: boolean;
	/** Whether it starts open, as when it is all its card holds. */
	unfolded?: boolean;
	/** Whether it goes untitled and always open, as when its card is titled Assumed. */
	bare?: boolean;
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
	const [unfolded, setUnfolded] = useState(open);
	const item = (assumed: Question, at: number, shown: boolean) => {
		const answer = answers[at] ?? null;
		return opened.has(assumed.number) || answer !== null ? (
			<ChallengeCard
				key={assumed.number}
				// What it shows is above it already.
				assumed={
					shown ? { ...assumed, body: shownIn(assumed.body).said } : assumed
				}
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
				onChallenge={() => toggle(assumed.number, true)}
			/>
		);
	};
	const segments = exhibited(assumptions);
	const rows = segments.map(({ shown, captions }) =>
		shown === null ? (
			captions.map(({ assumed, at }) => item(assumed, at, false))
		) : (
			<li key={captions[0]?.assumed.number}>
				{/* A rule down its left, never a box: it holds its rows, which a
				box inside the card would nest. */}
				<figure
					aria-label={`exhibit for ${captions.map(({ assumed }) => `assumption ${assumed.number}`).join(" and ")}`}
					className="my-1.5 ml-4 flex flex-col border-muted-foreground/30 border-l-2"
				>
					{named(shown) !== null && (
						<figcaption className="pb-1 pl-3 font-medium text-muted-foreground text-xs">
							{named(shown)}
						</figcaption>
					)}
					<Markdown text={shown} className="pr-4 pl-3 [&_p]:my-0" />
					<ol className="flex flex-col pt-1.5 [&>li]:pl-3">
						{captions.map(({ assumed, at }) => item(assumed, at, true))}
					</ol>
				</figure>
			</li>
		),
	);
	// An exhibit is there to be looked at, so a list that shows one never folds.
	if (bare || segments.some(({ shown }) => shown !== null)) {
		return (
			<section aria-label="Assumptions" className="@container">
				<ol className="flex flex-col py-1.5">{rows}</ol>
			</section>
		);
	}
	const challenged = answers.some((answer) => answer != null);
	return (
		<Collapsible
			open={unfolded || challenged}
			onOpenChange={setUnfolded}
			disabled={challenged}
			render={<section aria-label="Assumptions" />}
			className="@container group/assumptions flex flex-col"
		>
			<CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-1.5 px-4 py-2.5 font-medium text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 aria-disabled:cursor-default aria-disabled:hover:text-muted-foreground">
				<ChevronRightIcon className="size-3.5 transition-transform duration-150 group-data-[open]/assumptions:rotate-90" />
				Assumptions
				<span className="tabular-nums">{assumptions.length}</span>
			</CollapsibleTrigger>
			<CollapsibleContent render={<ol />} className="flex flex-col pb-1.5">
				{rows}
			</CollapsibleContent>
		</Collapsible>
	);
}

/** What an exhibit shows, as its first image's alt text says it; null for none. */
function named(shown: string): string | null {
	return /!\[([^\]]+)\]/.exec(shown)?.[1] ?? null;
}

/**
 * `assumptions` by number, each kept with its position, those beside each
 * other that show the same exhibit, their bodies' images and code blocks,
 * gathered under it; null for those that show none.
 */
function exhibited(
	assumptions: Question[],
): { shown: string | null; captions: { assumed: Question; at: number }[] }[] {
	const segments: {
		shown: string | null;
		captions: { assumed: Question; at: number }[];
	}[] = [];
	for (const { assumed, at } of assumptions
		.map((assumed, at) => ({ assumed, at }))
		.toSorted(
			(one, other) => Number(one.assumed.number) - Number(other.assumed.number),
		)) {
		const { shown } = shownIn(assumed.body);
		const last = segments.at(-1);
		if (shown !== null && last?.shown === shown) {
			last.captions.push({ assumed, at });
		} else {
			segments.push({ shown, captions: [{ assumed, at }] });
		}
	}
	return segments;
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
 * Says, in the review card's actions beside Send and Merge, that the agent
 * changed its assumptions since the person started challenging them,
 * reassures them their challenges carry over to those still there, and
 * offers to show them as they are now.
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
 * An assumption as a question card: every choice offered, the one the agent
 * took tagged Assumed and picked until another is. Picking it again
 * withdraws the challenge.
 */
function ChallengeCard({
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

/** One assumption: what it asked, over the choice the agent took. */
function AssumptionRow({
	assumed,
	challenge,
	live,
	onChallenge,
}: {
	assumed: Question;
	/** The challenge written to it, shown in place of what it took; null for none. */
	challenge: Answer | null;
	live: boolean;
	onChallenge: () => void;
}): JSX.Element {
	const { number, text, choices } = assumed;
	const taken = choices.filter((choice) => choice.chosen);
	const picked = choices.filter((choice) =>
		challenge?.picks.includes(choice.key),
	);
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
