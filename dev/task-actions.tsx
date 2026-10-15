import {
	CheckIcon,
	EllipsisIcon,
	FileDiffIcon,
	type LucideIcon,
	MessageCircleQuestionIcon,
	RotateCcwIcon,
	Trash2Icon,
} from "lucide-react";
import { type JSX, type ReactNode, useContext, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#dev/components/ui/dialog.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#dev/components/ui/dropdown-menu.tsx";
import type { Question } from "../plan";
import type { Details } from "../show";
import { removeTask, retryTask } from "./api";
import { useWide } from "./app-nav";
import { touchItems } from "./board";
import { ReviewChanges } from "./changes";
import { TASK } from "./conversation-address";
import { Dispatching, OnIt, StartItems, StartMenu } from "./dispatching";
import { Refusal, useRefusal } from "./refusal";
import { arriveAt } from "./task-view";

/** Something to do with a task: a button in the bar, or an item in its menu. */
interface Action {
	label: string;
	Icon: LucideIcon;
	run: () => void;
	/** Whether doing it closes the task's dialog, as for what opens elsewhere. */
	closes: boolean;
	disabled?: boolean;
	destructive?: boolean;
}

/**
 * Everything to do with a task, in one row: the conversations on it, or a
 * way to start one; its open questions, when no conversation here asks
 * them; its changes; another round of merges once it is out of them. On a
 * phone, past two, the most pressing one and a menu of the rest.
 */
export function ActionBar({
	task,
	open,
	retry,
	onAnswer,
}: {
	task: Details;
	open: Question[];
	retry: Action | null;
	/** Answers them in the dialog, when the page runs no conversations. */
	onAnswer: () => void;
}): JSX.Element {
	const context = useContext(Dispatching);
	const review = useContext(ReviewChanges);
	const wide = useWide();
	const remove = useRemove(task);
	// An arbor dev agent on the task asks its questions in its conversation,
	// so only an external agent's need answering from here.
	const answer: Action | null =
		open.length === 0 ||
		(context !== null && context.dispatch.on(task.task).length > 0)
			? null
			: {
					label: `Answer ${open.length === 1 ? "a question" : `${open.length} questions`}`,
					Icon: MessageCircleQuestionIcon,
					closes: context !== null,
					run:
						context === null
							? onAnswer
							: () => {
									const address = `${TASK}${task.task}`;
									arriveAt(address);
									context.open(address);
								},
				};
	const changes: Action | null =
		review !== null && (task.ahead ?? 0) > 0
			? {
					label: "Review changes",
					Icon: FileDiffIcon,
					closes: true,
					run: () => review(task.task),
				}
			: null;
	// The conversations on it show beside the actions; with none, starting one is one.
	const chatting =
		context?.dispatch.on(task.task).some((row) => row.conversation !== null) ??
		false;
	const starts = context !== null && !chatting;
	if (wide) {
		return (
			<div
				role="toolbar"
				aria-label="actions"
				className="flex w-full flex-wrap items-center justify-between gap-1.5"
			>
				<div className="flex flex-wrap items-center gap-1.5">
					{chatting && <OnIt task={task.task} variant="chips" />}
					{starts && <Start task={task.task} />}
				</div>
				<div className="flex flex-wrap items-center gap-1.5">
					{[remove.action, retry, changes].map(
						(action) =>
							action !== null && (
								<ActionButton key={action.label} action={action} outline />
							),
					)}
					{answer !== null && <ActionButton action={answer} />}
				</div>
				{remove.asking}
			</div>
		);
	}
	// Most pressing first; removing never leads, since it cannot be undone.
	const [lead, ...rest] = [answer, changes, retry].filter(
		(action) => action !== null,
	);
	const count =
		(lead === undefined ? 0 : 1 + rest.length) + (starts ? 1 : 0) + 1;
	return (
		<div
			role="toolbar"
			aria-label="actions"
			className="flex w-full flex-col gap-2 [&_button]:h-10"
		>
			{/* A row of its own, so it names whose spinner it is. */}
			{chatting && <OnIt task={task.task} variant="rows" className="-mx-2" />}
			{count <= 2 || lead === undefined ? (
				<div className="flex gap-2 [&>*]:flex-1">
					<ActionButton action={remove.action} outline />
					{starts && <Start task={task.task} wide />}
					{lead !== undefined && <ActionButton action={lead} />}
				</div>
			) : (
				<div className="flex gap-2">
					<ActionButton action={lead} className="flex-1" />
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button
									variant="outline"
									size="icon"
									aria-label="More actions"
									className="size-10"
								/>
							}
						>
							<EllipsisIcon />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className={`w-60 ${touchItems}`}>
							{rest.map((action) => (
								<ActionItem key={action.label} action={action} />
							))}
							{starts && (
								<>
									{rest.length > 0 && <DropdownMenuSeparator />}
									<StartItems assignment={{ kind: "task", task: task.task }} />
								</>
							)}
							<DropdownMenuSeparator />
							<DropdownMenuGroup>
								<ActionItem action={remove.action} />
							</DropdownMenuGroup>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			)}
			{remove.asking}
		</div>
	);
}

/** A way to put an agent on the task, in a new conversation or one going. */
function Start({
	task,
	wide = false,
}: {
	task: string;
	/** Whether it fills its row, as on a phone. */
	wide?: boolean;
}): JSX.Element {
	return (
		<StartMenu
			assignment={{ kind: "task", task }}
			label="Start a conversation"
			size="sm"
			className={wide ? "w-full flex-1 justify-center" : undefined}
		/>
	);
}

/** An action as a button, closing the dialog when it opens elsewhere. */
function ActionButton({
	action,
	outline = false,
	className,
}: {
	action: Action;
	outline?: boolean;
	className?: string;
}): JSX.Element {
	const props = {
		size: "sm",
		variant: outline ? "outline" : "default",
		disabled: action.disabled,
		onClick: action.run,
		className,
	} as const;
	const face = (
		<>
			<action.Icon />
			{action.label}
		</>
	);
	return action.closes ? (
		<DialogClose render={<Button {...props} />}>{face}</DialogClose>
	) : (
		<Button {...props}>{face}</Button>
	);
}

/** An action as an item in the bar's menu, closing the dialog likewise. */
function ActionItem({ action }: { action: Action }): JSX.Element {
	const props = {
		disabled: action.disabled,
		variant: action.destructive ? "destructive" : "default",
		onClick: action.run,
	} as const;
	const face = (
		<>
			<action.Icon />
			{action.label}
		</>
	);
	return action.closes ? (
		<DialogClose render={<DropdownMenuItem {...props} />}>{face}</DialogClose>
	) : (
		<DropdownMenuItem {...props}>{face}</DropdownMenuItem>
	);
}

/**
 * Removes the task as `arbor remove` does, asking first while an agent works
 * on it (a conversation here mid-turn, which stops and carries on in the main
 * tree, or an external agent holding its lease, which the page cannot stop) or
 * while it has commits its base lacks, which go with its branch: the action,
 * and the dialog that asks, with what went wrong under it.
 */
function useRemove(task: Details): { action: Action; asking: ReactNode } {
	const context = useContext(Dispatching);
	const [asking, setAsking] = useState(false);
	const [removing, setRemoving] = useState(false);
	const { refusal, refuse } = useRefusal();
	const working = (context?.dispatch.on(task.task) ?? []).filter(
		({ conversation }) =>
			conversation?.status === "starting" || conversation?.status === "running",
	).length;
	const external = task.lease === "held";
	const ahead = task.ahead ?? 0;
	const go = () => {
		setAsking(false);
		setRemoving(true);
		removeTask(task.task).catch((error: unknown) => {
			setRemoving(false);
			refuse("Not removed", error);
		});
	};
	return {
		action: {
			label: removing ? "Removing…" : "Remove",
			Icon: Trash2Icon,
			closes: false,
			disabled: removing,
			destructive: true,
			run: () =>
				working > 0 || external || ahead > 0 ? setAsking(true) : go(),
		},
		asking: (
			<>
				<Refusal refusal={refusal} className="w-full" />
				<Dialog open={asking} onOpenChange={setAsking}>
					<DialogContent showCloseButton={false}>
						<DialogHeader>
							<DialogTitle>Remove {task.task}?</DialogTitle>
							<DialogDescription>
								{working > 0
									? `${working === 1 ? "An agent is" : `${working} agents are`} still working on it. Removing stops ${working === 1 ? "it" : "them"} and moves ${working === 1 ? "its conversation" : "their conversations"} to the main tree. `
									: external
										? "An agent outside the page is working on it, which the page cannot stop: its next arbor command finds the task gone. "
										: ""}
								{ahead > 0
									? `Its ${ahead} commit${ahead === 1 ? "" : "s"} not on ${task.base}, its worktree and any uncommitted changes are discarded.`
									: "Its worktree, branch and uncommitted changes are discarded."}
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<DialogClose render={<Button variant="outline" />}>
								Cancel
							</DialogClose>
							<Button variant="destructive" onClick={go}>
								Remove
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</>
		),
	};
}

/** Escalated with its merge attempts spent: what `arbor retry` is for. */
function outOfMerges(task: Details): boolean {
	return (
		task.status === "escalated" &&
		task.review === null &&
		task.mergeAttempts >= task.mergeAttemptLimit
	);
}

/**
 * Another round of merge attempts for a task out of them, as `arbor retry`
 * gives: its action for the action bar, and the line under the bar on what
 * it gives, or once granted, that the task is working again and what picks
 * it up. Nothing while the task has merges left.
 */
export function useRetry(task: Details): {
	action: Action | null;
	note: ReactNode;
} {
	const [state, setState] = useState<"idle" | "retrying" | "retried">("idle");
	const [failed, setFailed] = useState<string | null>(null);
	if (state === "idle" && !outOfMerges(task)) {
		return { action: null, note: null };
	}
	const retry = () => {
		setState("retrying");
		setFailed(null);
		retryTask(task.task).then(
			() => setState("retried"),
			(error: unknown) => {
				setState("idle");
				setFailed(error instanceof Error ? error.message : String(error));
			},
		);
	};
	return {
		action: {
			label: state === "retried" ? "Retried" : "Retry",
			Icon: state === "retried" ? CheckIcon : RotateCcwIcon,
			closes: false,
			disabled: state !== "idle",
			run: retry,
		},
		note: (
			<div className="mt-1 flex flex-col gap-1 text-xs">
				<p className="text-muted-foreground">
					{state === "retried" ? (
						<>
							Working again: <code>arbor claim {task.task}</code> picks it up.
						</>
					) : (
						<>
							Retry gives another {task.mergeAttemptLimit} merge attempts, as{" "}
							<code>arbor retry</code> does.
						</>
					)}
				</p>
				{failed !== null && <p className="text-destructive">{failed}</p>}
			</div>
		),
	};
}
