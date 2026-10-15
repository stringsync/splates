import { useAui, useAuiState } from "@assistant-ui/react";
import { useReactive } from "@webappwiz/react";
import { XIcon } from "lucide-react";
import { useContext } from "react";
import type { DictationDecision, EditKind } from "webappwiz/dictate";
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Dictation } from "./dictation";
import { DictationContext } from "./dictation-context";
import type { Mark, TakeReview } from "./take-review";

/** What each kind of edit is called, as a screen reader and the cost lines say it. */
const NAMES: Record<EditKind, string> = {
	correction: "Correction",
	filler: "Filler",
	tag: "Tag",
	item: "List",
};

/**
 * What a take's cleanups did to it, below the message while it still holds
 * the take: the cleaned text with each edit marked, so one tap undoes a
 * sure edit or makes a suggested one, and the message follows. Null once the
 * message no longer holds the take's text, as when it was typed over or sent.
 */
export function DictationReview() {
	const dictation = useContext(DictationContext);
	return dictation === null ? null : <Review dictation={dictation} />;
}

function Review({ dictation }: { dictation: Dictation }) {
	const review = useReactive(dictation, (each) => each.state.review, [
		"changed",
	]);
	const text = useAuiState((state) => state.composer.text);
	const aui = useAui();
	if (review === undefined || !text.includes(review.text())) {
		return null;
	}
	// The take sits at the end of the message, after whatever was typed
	// before it, so the last place its text appears is where it is.
	const flip = (next: TakeReview) => {
		const current = review.text();
		const at = text.lastIndexOf(current);
		aui
			.composer()
			.setText(
				text.slice(0, at) + next.text() + text.slice(at + current.length),
			);
		dictation.revise(next);
	};
	return (
		<section
			aria-label="Dictation cleanup"
			className="dictation-review flex flex-col gap-2 px-2.5 text-sm"
		>
			<div className="flex items-center gap-1.5">
				<span className="text-muted-foreground mr-auto">Cleanup</span>
				<Choice
					pressed={review.isAsSaid}
					onClick={() => flip(review.undoneAll())}
				>
					As said
				</Choice>
				<Choice
					pressed={review.isCleaned}
					onClick={() => flip(review.asCleaned())}
				>
					Cleaned up
				</Choice>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="text-muted-foreground size-6 shrink-0 rounded-full pointer-coarse:size-10"
					aria-label="Dismiss cleanup"
					onClick={() => dictation.revise(undefined)}
				>
					<XIcon className="size-3.5" />
				</Button>
			</div>
			<p className="leading-6 whitespace-pre-wrap">
				{review.parts().map((part, at) =>
					typeof part === "string" ? (
						// biome-ignore lint/suspicious/noArrayIndexKey: the parts never reorder
						<span key={`text-${at}`}>{part}</span>
					) : (
						<MarkButton
							key={`mark-${part.index}`}
							mark={part.mark}
							onClick={() => flip(review.toggled(part.index))}
						/>
					),
				)}
			</p>
			<Decisions decisions={review.decisions} />
		</section>
	);
}

function Choice({
	pressed,
	onClick,
	children,
}: {
	pressed: boolean;
	onClick: () => void;
	children: string;
}) {
	return (
		<Button
			type="button"
			variant={pressed ? "secondary" : "ghost"}
			size="sm"
			className="h-7 rounded-md px-2 pointer-coarse:h-10 pointer-coarse:px-3"
			aria-pressed={pressed}
			onClick={onClick}
		>
			{children}
		</Button>
	);
}

/**
 * One edit in the text, a button that flips it. Made, it shows what it
 * dropped struck through before what it wrote; suggested and not made, the
 * words it would change, dashed.
 */
function MarkButton({ mark, onClick }: { mark: Mark; onClick: () => void }) {
	const name = NAMES[mark.kind];
	return (
		<button
			type="button"
			aria-pressed={mark.on}
			aria-label={`${mark.on ? "Undo" : mark.suggested ? "Make suggested" : "Make"} ${name.toLowerCase()}: ${describe(mark)}`}
			className={cn(
				"inline-flex min-h-6 items-center rounded px-0.5 align-middle whitespace-pre-wrap pointer-coarse:min-h-10 pointer-coarse:px-1.5",
				mark.on
					? "bg-primary/10 hover:bg-primary/15"
					: "outline-1 outline-dashed outline-amber-600/70 hover:bg-amber-500/10 dark:outline-amber-400/70",
			)}
			onClick={onClick}
		>
			{mark.on ? (
				<>
					{mark.original !== "" && (
						<del className="text-muted-foreground">{mark.original}</del>
					)}
					{mark.edited !== "" && (
						<ins className="no-underline">{mark.edited}</ins>
					)}
				</>
			) : (
				mark.original
			)}
		</button>
	);
}

/** An edit as `"was" → "is"`, for a screen reader. */
function describe(mark: Mark): string {
	const show = (words: string) => (words === "" ? "nothing" : `"${words}"`);
	return `${show(mark.original)} to ${show(mark.edited)}`;
}

/** What the take asked its models, folded away: every question, its answer, how long and what it cost. */
function Decisions({ decisions }: { decisions: readonly DictationDecision[] }) {
	if (decisions.length === 0) {
		return null;
	}
	const seconds =
		decisions.reduce((sum, each) => sum + each.latencyMs, 0) / 1000;
	const dollars = decisions.reduce((sum, each) => sum + each.dollars, 0);
	return (
		<details className="text-muted-foreground text-xs">
			<summary className="cursor-pointer py-1 pointer-coarse:py-3">
				{`${decisions.length} ${decisions.length === 1 ? "question set" : "question sets"} · ${seconds.toFixed(1)} s · ${money(dollars)}`}
			</summary>
			<div className="flex flex-col gap-3 pb-1">
				{decisions.map((decision, at) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: the decisions never reorder
					<div key={at} className="flex flex-col gap-1">
						<p className="text-foreground font-medium">
							{NAMES[decision.cleanup]} · {decision.model} ·{" "}
							{Math.round(decision.latencyMs)} ms · {money(decision.dollars)} ·{" "}
							{decision.inputTokens} in, {decision.outputTokens} out
						</p>
						<p className="font-mono whitespace-pre-wrap">{decision.state}</p>
						<ul className="flex flex-col gap-1">
							{decision.questions.map((question) => (
								<li key={question.id}>
									<span className="font-mono">{question.id}</span>{" "}
									{question.instructions}{" "}
									<span className="text-foreground">→ {question.answer}</span>
								</li>
							))}
						</ul>
					</div>
				))}
			</div>
		</details>
	);
}

function money(dollars: number): string {
	return `$${dollars.toFixed(4)}`;
}
