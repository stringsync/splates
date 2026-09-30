import { InboxIcon, MessageCircleIcon } from "lucide-react";
import { type JSX, useState } from "react";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "#dev/components/ui/empty.tsx";
import { Sheet } from "#dev/components/ui/sheet.tsx";
import type { OpenQuestion } from "../inbox";
import type { Snapshot } from "../snapshot";
import { reply } from "./api";
import { Composer } from "./compose";
import { ItemSheet, plain } from "./question";

/** A question by name, rather than the object, so it keeps up with the plan. */
interface Named {
	task: string;
	number: string;
}

/**
 * What waits on you: the questions with no reply yet, grouped by task. A
 * question moves to Sent once answered.
 */
export function Inbox({ snapshot }: { snapshot: Snapshot }): JSX.Element {
	const { questions } = snapshot.inbox;
	const [opened, setOpened] = useState<Named | null>(null);

	const current =
		opened === null
			? undefined
			: questions.find(
					(question) =>
						question.task === opened.task && question.number === opened.number,
				);

	return (
		<>
			{questions.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<InboxIcon />
						</EmptyMedia>
						<EmptyTitle>Nothing needs you</EmptyTitle>
						<EmptyDescription>
							Questions agents escalate show up here.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="flex flex-col gap-6">
					{[...group(questions)].map(([task, asked]) => (
						<section
							key={task}
							aria-label={task}
							className="flex flex-col gap-1"
						>
							<h2 className="text-muted-foreground text-xs">{task}</h2>
							{asked.map((question) => (
								<Row
									key={question.number}
									question={question}
									onOpen={() =>
										setOpened({ task: question.task, number: question.number })
									}
								/>
							))}
						</section>
					))}
				</div>
			)}
			<Sheet
				open={current !== undefined}
				onOpenChange={(open) => {
					if (!open) {
						setOpened(null);
					}
				}}
			>
				{current && (
					<ItemSheet
						task={current.task}
						id={current.number}
						details={snapshot.tasks.find((task) => task.task === current.task)}
						title={current.text}
						body={current.body}
					>
						<Respond question={current} onSent={() => setOpened(null)} />
					</ItemSheet>
				)}
			</Sheet>
		</>
	);
}

/** One question on one line: its number and its subject. */
function Row({
	question,
	onOpen,
}: {
	question: OpenQuestion;
	onOpen: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onOpen}
			className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted"
		>
			<span className="w-7 shrink-0 text-muted-foreground text-xs tabular-nums">
				{question.number}
			</span>
			<span className="min-w-0 flex-1 truncate text-sm">
				{plain(question.text)}
			</span>
			{question.lease === "held" && (
				<MessageCircleIcon
					role="img"
					aria-label="answer it in its chat"
					className="size-4 shrink-0 text-warning"
				/>
			)}
		</button>
	);
}

/** A reply box, or where to answer instead when its agent is in a chat. */
function Respond({
	question,
	onSent,
}: {
	question: OpenQuestion;
	onSent: () => void;
}): JSX.Element {
	if (question.lease === "held") {
		return (
			<p className="flex gap-2 text-muted-foreground text-sm">
				<MessageCircleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
				Its agent is in a live session. Answer it in that chat.
			</p>
		);
	}
	const offers = question.choices.length > 0;
	return (
		<Composer
			task={question.task}
			question={question}
			label="Send"
			placeholder={
				offers ? "Add context (optional), @ for a file" : "Reply, @ for a file"
			}
			send={(composed) =>
				reply({ task: question.task, question: question.number, ...composed })
			}
			onDone={onSent}
		/>
	);
}

/** Questions by task, in the order the inbox lists them. */
function group(questions: OpenQuestion[]): Map<string, OpenQuestion[]> {
	const byTask = new Map<string, OpenQuestion[]>();
	for (const question of questions) {
		byTask.set(question.task, [...(byTask.get(question.task) ?? []), question]);
	}
	return byTask;
}
