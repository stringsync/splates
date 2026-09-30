import { type JSX, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { toast } from "#dev/components/ui/toast.tsx";
import type { OpenQuestion } from "../inbox";
import type { Snapshot } from "../snapshot";
import { withdraw } from "./api";
import { waiting } from "./inbox";
import { plain } from "./question";

/**
 * One line across the top, always there so nothing under it moves: the last
 * reply you sent while its agent has yet to read it, with a way to take it
 * back, and otherwise where things stand.
 */
export function Banner({ snapshot }: { snapshot: Snapshot }): JSX.Element {
	const latest = latestUnread(snapshot.inbox.questions);
	return (
		<section
			aria-label="banner"
			aria-live="polite"
			className="flex h-10 items-center gap-3 rounded-lg bg-muted px-3 text-sm"
		>
			{latest ? <Latest question={latest} /> : <Standing snapshot={snapshot} />}
		</section>
	);
}

function Latest({ question }: { question: OpenQuestion }): JSX.Element {
	const [sending, setSending] = useState(false);
	const said = question.pending?.text ?? "";
	return (
		<>
			<span className="min-w-0 flex-1 truncate">
				<span className="text-muted-foreground">
					Sent to {question.task} {question.number}:{" "}
				</span>
				{plain(said) || "files"}
			</span>
			<Button
				variant="ghost"
				size="xs"
				className="-mr-1 shrink-0"
				disabled={sending}
				onClick={() => {
					setSending(true);
					withdraw(question.task, question.number).then(
						() => setSending(false),
						(error: unknown) => {
							setSending(false);
							toast.add({
								title: "Not withdrawn",
								description:
									error instanceof Error ? error.message : String(error),
								type: "error",
							});
						},
					);
				}}
			>
				Withdraw
			</Button>
		</>
	);
}

/** Nothing to take back: how much waits on you, and on the agents. */
function Standing({ snapshot }: { snapshot: Snapshot }): JSX.Element {
	const yours = waiting(snapshot).length;
	const theirs = snapshot.inbox.questions.filter(
		(question) => question.state === "waiting" || question.state === "editing",
	).length;
	return (
		<span className="truncate text-muted-foreground">
			{yours === 0
				? "Nothing waiting on you"
				: `${yours} ${yours === 1 ? "question needs" : "questions need"} you`}
			{theirs > 0 &&
				` · ${theirs} waiting for ${theirs === 1 ? "its agent" : "their agents"}`}
		</span>
	);
}

/**
 * The reply sent most recently that its agent has yet to read, and so can
 * still be withdrawn; none once it has been read.
 */
function latestUnread(questions: OpenQuestion[]): OpenQuestion | undefined {
	return questions
		.filter(
			(question) => question.pending !== null && question.lease !== "held",
		)
		.sort((left, right) =>
			(right.pending?.repliedAt ?? "").localeCompare(
				left.pending?.repliedAt ?? "",
			),
		)[0];
}
