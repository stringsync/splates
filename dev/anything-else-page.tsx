import { CheckIcon, ChevronRightIcon } from "lucide-react";
import type { JSX } from "react";
import type { Question } from "../plan";
import type { Answer } from "../reply";
import { CardBox } from "./card-box";
import type { Files } from "./files";
import { Markdown } from "./markdown";

/**
 * The last screen of a questions card shown a question a screen, as on a
 * phone: "Anything else" to write, over each question answered or not, a tap
 * from going back to change it.
 */
export function AnythingElsePage({
	questions,
	answers,
	more,
	onMore,
	files,
	onTurn,
}: {
	questions: Question[];
	/** What is written to each question, by position; null for nothing. */
	answers: (Answer | null)[];
	more: string;
	onMore: (more: string) => void;
	/** What is attached to "Anything else", where the reply can carry files. */
	files: Files | null;
	/** Goes back to the question at `at`. */
	onTurn: (at: number) => void;
}): JSX.Element {
	return (
		<section
			aria-label="anything else"
			className="flex flex-col gap-5 px-5 py-5"
		>
			<div className="flex flex-col gap-3">
				<span className="font-semibold text-lg leading-snug">
					Anything else?
				</span>
				<CardBox
					roomy
					data-stop="more"
					aria-label="Anything else"
					value={more}
					placeholder="Optional"
					onValue={onMore}
					files={files}
					className="min-h-28"
				/>
			</div>
			<ol aria-label="your answers" className="flex flex-col gap-2">
				{questions.map((asked, at) => (
					<li key={asked.number}>
						<button
							type="button"
							onClick={() => onTurn(at)}
							className="flex min-h-12 w-full items-center gap-3 rounded-xl border bg-card px-4 py-2 text-left active:bg-muted"
						>
							<span className="min-w-0 flex-1 truncate text-sm">
								<Markdown text={asked.text} inline unlinked />
							</span>
							{answers[at] === null ? (
								<span className="shrink-0 text-muted-foreground text-sm">
									Not answered
								</span>
							) : (
								<CheckIcon
									aria-label="answered"
									className="size-5 shrink-0 text-success"
								/>
							)}
							<ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
						</button>
					</li>
				))}
			</ol>
		</section>
	);
}
