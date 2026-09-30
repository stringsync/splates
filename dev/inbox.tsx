import { CheckIcon, GitBranchIcon, MessageCircleIcon } from "lucide-react";
import { type JSX, useState } from "react";
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
import { approve, defer, fileUrl, reply, skip, withdraw } from "./api";
import { Composer, Held } from "./compose";
import { Markdown } from "./markdown";
import { ItemSheet, Lightbox, plain } from "./question";
import { Task } from "./tasks";

/** A question by name, rather than the object, so it keeps up with the plan. */
interface Named {
	task: string;
	number: string;
}

/**
 * Every task, each with the questions it asked: the ones waiting on you
 * first, then the answered ones, to follow up until the task lands. A task
 * asking to be approved shows that alone.
 */
export function Inbox({ snapshot }: { snapshot: Snapshot }): JSX.Element {
	const { questions } = snapshot.inbox;
	const [opened, setOpened] = useState<Named | null>(null);
	const [viewing, setViewing] = useState<string | null>(null);

	const current =
		opened === null
			? undefined
			: questions.find(
					(question) =>
						question.task === opened.task && question.number === opened.number,
				);
	const shown = viewing === null ? undefined : find(snapshot.tasks, viewing);

	if (snapshot.tasks.length === 0) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<GitBranchIcon />
					</EmptyMedia>
					<EmptyTitle>No tasks</EmptyTitle>
					<EmptyDescription>
						<code>arbor add &lt;task&gt;</code> starts one.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			{sorted(snapshot.tasks, questions).map((task) => {
				const asked = questions.filter(
					(question) => question.task === task.task,
				);
				const review = underReview(task, asked);
				return (
					<section
						key={task.task}
						aria-label={task.task}
						className="flex flex-col gap-1"
					>
						<div className="flex items-center gap-2">
							<h2 className="truncate font-medium text-sm">{task.task}</h2>
							<span className="text-muted-foreground text-xs">
								{task.status}
							</span>
							<Button
								variant="outline"
								size="xs"
								className="ml-auto"
								aria-label={`View ${task.task}`}
								onClick={() => setViewing(task.task)}
							>
								View
							</Button>
						</div>
						{review ? (
							<Review
								task={task}
								question={review}
								onChanges={() =>
									setOpened({ task: task.task, number: review.number })
								}
							/>
						) : (
							ordered(asked).map((question) => (
								<Row
									key={question.number}
									question={question}
									onOpen={() =>
										setOpened({ task: question.task, number: question.number })
									}
								/>
							))
						)}
					</section>
				);
			})}
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
				open={shown !== undefined}
				onOpenChange={(open) => {
					if (!open) {
						setViewing(null);
					}
				}}
			>
				{shown && <Task task={shown} />}
			</Sheet>
		</div>
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
					// Answered, so it steps back from what still waits on you.
					question.state !== "open" && "text-muted-foreground",
				)}
			>
				{plain(question.text)}
			</span>
			{question.state === "open" && question.lease === "held" && (
				<MessageCircleIcon
					role="img"
					aria-label="answer it in its chat"
					className="size-4 shrink-0 text-warning"
				/>
			)}
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
 * A task asking to be approved: what it says to look at and how big it is,
 * and the two answers, in place of its questions.
 */
function Review({
	task,
	question,
	onChanges,
}: {
	task: Details;
	question: OpenQuestion;
	onChanges: () => void;
}): JSX.Element {
	const [sending, setSending] = useState(false);
	const held = question.lease === "held";
	return (
		<div className="flex flex-col gap-3 rounded-lg border p-3">
			<p className="font-medium text-sm">{plain(question.text)}</p>
			{question.body !== "" && (
				<Markdown
					text={question.body}
					className="text-sm"
					image={(path, alt) => (
						<Lightbox src={fileUrl(path, task.task)} alt={alt || path} />
					)}
				/>
			)}
			<p className="text-muted-foreground text-xs tabular-nums">
				{task.ahead ?? "?"} {task.ahead === 1 ? "commit" : "commits"}
				{task.added !== null && (
					<>
						{" "}
						<span className="text-success">+{task.added}</span>{" "}
						<span className="text-destructive">-{task.removed ?? 0}</span>
					</>
				)}
			</p>
			{held ? (
				<p className="text-muted-foreground text-sm">
					Its agent is in a live session. Answer it in that chat.
				</p>
			) : (
				<div className="flex gap-2">
					<Button
						size="sm"
						disabled={sending}
						onClick={() => {
							setSending(true);
							approve(question.task, question.number).catch(
								(error: unknown) => {
									setSending(false);
									failed("Not approved", error);
								},
							);
						}}
					>
						Approve
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={sending}
						onClick={onChanges}
					>
						Request changes
					</Button>
				</div>
			)}
		</div>
	);
}

/**
 * What can be done about a question from its sheet: answer, defer or skip one
 * that is open; change or withdraw a reply its agent has yet to read; follow
 * up one it has. A live agent is answered in its chat instead.
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
			<p className="flex gap-2 text-muted-foreground text-sm">
				<MessageCircleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
				Its agent is in a live session. Answer it in that chat.
			</p>
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
					failed(`${label} failed`, error);
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

function failed(title: string, error: unknown): void {
	toast.add({
		title,
		description: error instanceof Error ? error.message : String(error),
		type: "error",
	});
}

function find(tasks: Details[], name: string): Details | undefined {
	return tasks.find((task) => task.task === name);
}

/** The task's review question while it still waits on you, or null. */
function underReview(
	task: Details,
	asked: OpenQuestion[],
): OpenQuestion | null {
	const review = asked.find((question) => question.number === task.review);
	return review?.state === "open" ? review : null;
}

/** Open first, then the rest, each in the order the plan asks them. */
function ordered(asked: OpenQuestion[]): OpenQuestion[] {
	return [
		...asked.filter((question) => question.state === "open"),
		...asked.filter((question) => question.state !== "open"),
	];
}

/** Tasks with something waiting on you first, then the rest as listed. */
function sorted(tasks: Details[], questions: OpenQuestion[]): Details[] {
	const waiting = new Set(
		questions
			.filter((question) => question.state === "open")
			.map((question) => question.task),
	);
	return [
		...tasks.filter((task) => waiting.has(task.task)),
		...tasks.filter((task) => !waiting.has(task.task)),
	];
}
