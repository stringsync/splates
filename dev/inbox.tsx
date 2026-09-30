import { CheckIcon, InboxIcon, SendIcon } from "lucide-react";
import { type JSX, type ReactNode, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "#dev/components/ui/empty.tsx";
import { Sheet } from "#dev/components/ui/sheet.tsx";
import { toast } from "#dev/components/ui/toast.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { OpenQuestion, QuestionState } from "../inbox";
import type { Details } from "../show";
import type { Snapshot } from "../snapshot";
import { approve, defer, reply, skip, withdraw } from "./api";
import { Composer, Held } from "./compose";
import { ItemSheet, plain } from "./question";
import { Task } from "./tasks";

/** A question by name, rather than the object, so it keeps up with the plan. */
interface Named {
	task: string;
	number: string;
}

/**
 * What waits on you: each unanswered question, grouped by task. A task whose
 * agent is in a live session is left out, since it is answered in that chat.
 */
export function Inbox({ snapshot }: { snapshot: Snapshot }): JSX.Element {
	return (
		<Questions
			snapshot={snapshot}
			shown={waiting(snapshot)}
			empty={
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
			}
		/>
	);
}

/**
 * Every question you answered, each saying where it stands, to change while
 * its agent has yet to read it and to follow up after, until its task lands.
 */
export function Sent({ snapshot }: { snapshot: Snapshot }): JSX.Element {
	return (
		<Questions
			snapshot={snapshot}
			shown={snapshot.inbox.questions.filter(answered)}
			empty={
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<SendIcon />
						</EmptyMedia>
						<EmptyTitle>Nothing sent</EmptyTitle>
						<EmptyDescription>
							Questions you answer show up here until their task lands.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			}
		/>
	);
}

/** The questions the inbox counts: open, and not for a live agent's chat. */
export function waiting(snapshot: Snapshot): OpenQuestion[] {
	return snapshot.inbox.questions.filter(
		(question) => question.state === "open" && question.lease !== "held",
	);
}

/** Answered by a person, whether its agent has read it yet or not. */
function answered(question: OpenQuestion): boolean {
	return (
		question.state !== "open" &&
		(question.pending !== null || question.reply !== null)
	);
}

/**
 * Questions grouped by task, one line each, a task only when it has some. Each
 * opens in a sheet to act on it; a task's View opens its plan.
 */
function Questions({
	snapshot,
	shown,
	empty,
}: {
	snapshot: Snapshot;
	shown: OpenQuestion[];
	empty: ReactNode;
}): JSX.Element {
	const [opened, setOpened] = useState<Named | null>(null);
	const [viewing, setViewing] = useState<string | null>(null);

	// Only among `shown`: a question answered from here moves to the other tab,
	// and its sheet closes rather than following it there.
	const current =
		opened === null
			? undefined
			: shown.find(
					(question) =>
						question.task === opened.task && question.number === opened.number,
				);
	const details = viewing === null ? undefined : find(snapshot.tasks, viewing);

	return (
		<>
			{shown.length === 0 ? (
				empty
			) : (
				<div className="flex flex-col gap-6">
					{[...group(shown)].map(([task, asked]) => (
						<section
							key={task}
							aria-label={task}
							className="flex flex-col gap-1"
						>
							<div className="flex items-center gap-2">
								<h2 className="truncate text-muted-foreground text-xs">
									{task}
								</h2>
								<Button
									variant="ghost"
									size="xs"
									className="-my-1 ml-auto text-muted-foreground"
									aria-label={`View ${task}`}
									onClick={() => setViewing(task)}
								>
									View
								</Button>
							</div>
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
						details={find(snapshot.tasks, current.task)}
						title={current.text}
						body={current.body}
					>
						<Respond
							question={current}
							review={find(snapshot.tasks, current.task)?.review ?? null}
							onDone={() => setOpened(null)}
						/>
					</ItemSheet>
				)}
			</Sheet>
			<Sheet
				open={details !== undefined}
				onOpenChange={(open) => {
					if (!open) {
						setViewing(null);
					}
				}}
			>
				{details && <Task task={details} />}
			</Sheet>
		</>
	);
}

/** One question on one line: its number, its subject, and where it stands. */
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
			<span
				className={cn(
					"min-w-0 flex-1 truncate text-sm",
					// Acted on, so it steps back from what is still in play.
					question.state === "done" && "text-muted-foreground",
				)}
			>
				{plain(question.text)}
			</span>
			<Status state={question.state} />
		</button>
	);
}

const STATUS: Record<QuestionState, string | null> = {
	open: null,
	waiting: "Waiting",
	editing: "Editing",
	read: "Read",
	done: "Done",
};

/** Where an answered question stands, in a word; nothing for an open one. */
function Status({ state }: { state: QuestionState }): JSX.Element | null {
	const label = STATUS[state];
	if (label === null) {
		return null;
	}
	return (
		<span className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
			{state === "read" && <CheckIcon className="size-3.5 text-success" />}
			{label}
		</span>
	);
}

/**
 * What can be done about a question from its sheet: answer, defer or skip one
 * that is open, or approve one asking to merge; change or withdraw a reply its
 * agent has yet to read; follow up one it has. A live agent is answered in its
 * chat instead.
 */
function Respond({
	question,
	review,
	onDone,
}: {
	question: OpenQuestion;
	/** The task's review question, if it is asking for one. */
	review: string | null;
	onDone: () => void;
}): JSX.Element {
	const { task, number, state, pending } = question;
	if (question.lease === "held") {
		return (
			<div className="flex flex-col gap-4">
				<Thread question={question} />
				<p className="text-muted-foreground text-sm">
					Its agent is in a live session. Say anything more in that chat.
				</p>
			</div>
		);
	}
	if ((state === "waiting" || state === "editing") && pending) {
		return (
			<div className="flex flex-col gap-4">
				<Thread question={question} />
				<Held task={task} id={number}>
					<div className="flex flex-col gap-2">
						<p className="text-muted-foreground text-xs">
							Its agent waits until you close this.
						</p>
						<Composer
							task={task}
							question={question.reply === null ? question : null}
							initial={{
								choices: pending.choices,
								text: pending.text,
								keep: pending.files,
							}}
							label="Update"
							placeholder="@ for a file"
							send={(composed) =>
								reply({ task, question: number, ...composed })
							}
							withdraw={() => withdraw(task, number)}
							onDone={onDone}
						/>
					</div>
				</Held>
			</div>
		);
	}
	if (state === "read" || state === "done") {
		return (
			<div className="flex flex-col gap-4">
				<Thread question={question} />
				<Composer
					task={task}
					label="Send"
					placeholder="Follow up, @ for a file"
					send={({ text, files, keep }) =>
						reply({ task, question: number, choices: [], text, files, keep })
					}
					onDone={onDone}
				/>
			</div>
		);
	}
	const reviewing = review === number;
	const offers = question.choices.length > 0;
	return (
		<div className="flex flex-col gap-3">
			<Composer
				task={task}
				question={question}
				label={reviewing ? "Request changes" : "Send"}
				placeholder={
					reviewing
						? "What needs changing, @ for a file"
						: offers
							? "Add context (optional), @ for a file"
							: "Reply, @ for a file"
				}
				send={(composed) => reply({ task, question: number, ...composed })}
				onDone={onDone}
			/>
			<div className="flex gap-2">
				{reviewing ? (
					<Action
						label="Approve"
						run={() => approve(task, number)}
						done={onDone}
					/>
				) : (
					<>
						<Action
							label="Defer"
							run={() => defer(task, number)}
							done={onDone}
						/>
						<Action label="Skip" run={() => skip(task, number)} done={onDone} />
					</>
				)}
			</div>
		</div>
	);
}

/** One tap that answers a question for you. */
function Action({
	label,
	run,
	done,
}: {
	label: string;
	run: () => Promise<void>;
	done: () => void;
}): JSX.Element {
	const [sending, setSending] = useState(false);
	return (
		<Button
			variant="outline"
			size="sm"
			disabled={sending}
			onClick={() => {
				setSending(true);
				run().then(done, (error: unknown) => {
					setSending(false);
					toast.add({
						title: `${label} failed`,
						description: error instanceof Error ? error.message : String(error),
						type: "error",
					});
				});
			}}
		>
			{label}
		</Button>
	);
}

/** What was said so far: the answer its agent read, then each follow-up. */
function Thread({ question }: { question: OpenQuestion }): JSX.Element | null {
	const said = [
		...(question.reply === null ? [] : [question.reply]),
		...question.followUps,
	];
	if (said.length === 0) {
		return null;
	}
	return (
		<ol className="flex flex-col gap-1 rounded-lg bg-muted px-3 py-2 text-sm">
			{said.map((line, index) => (
				// Lines only ever get added, so where one sits is what it is.
				// biome-ignore lint/suspicious/noArrayIndexKey: append-only
				<li key={index} className="whitespace-pre-wrap break-words">
					{line}
				</li>
			))}
		</ol>
	);
}

function find(tasks: Details[], name: string): Details | undefined {
	return tasks.find((task) => task.task === name);
}

/** Questions by task, in the order the snapshot lists them. */
function group(questions: OpenQuestion[]): Map<string, OpenQuestion[]> {
	const byTask = new Map<string, OpenQuestion[]>();
	for (const question of questions) {
		byTask.set(question.task, [...(byTask.get(question.task) ?? []), question]);
	}
	return byTask;
}
