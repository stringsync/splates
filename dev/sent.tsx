import {
	CheckCheckIcon,
	CheckIcon,
	FileIcon,
	type LucideIcon,
	PencilLineIcon,
	SendIcon,
	SquarePenIcon,
} from "lucide-react";
import { type JSX, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "#dev/components/ui/empty.tsx";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "#dev/components/ui/sheet.tsx";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "#dev/components/ui/toggle-group.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Sent, SentState } from "../send";
import type { Snapshot } from "../snapshot";
import { fileUrl, message, reply, withdraw } from "./api";
import { Composer, Held } from "./compose";
import { stored } from "./files";
import { ItemSheet, plain } from "./question";

/** Something sent by name, rather than the object, so it keeps up. */
interface Named {
	task: string;
	id: string;
}

/**
 * Everything you sent each task's agent, replies and messages both, newest
 * first under each task: still changeable until its agent reads it, then
 * there to follow up, until the task lands or goes.
 */
export function SentTab({ snapshot }: { snapshot: Snapshot }): JSX.Element {
	const { sent } = snapshot;
	const [opened, setOpened] = useState<Named | null>(null);
	const [writing, setWriting] = useState(false);

	const current =
		opened === null
			? undefined
			: sent.find(
					(item) => item.task === opened.task && item.message.id === opened.id,
				);
	// Tasks a message can go to: any with a tree for its plan.
	const tasks = snapshot.tasks
		.filter((task) => task.status !== "orphaned")
		.map((task) => task.task);

	return (
		<div className="flex flex-col gap-4">
			<Button
				variant="outline"
				size="sm"
				className="self-end"
				disabled={tasks.length === 0}
				onClick={() => setWriting(true)}
			>
				<SquarePenIcon data-icon="inline-start" />
				New message
			</Button>
			{sent.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<SendIcon />
						</EmptyMedia>
						<EmptyTitle>Nothing sent</EmptyTitle>
						<EmptyDescription>
							Replies and messages you send show up here until their task lands.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="flex flex-col gap-6">
					{[...group(sent)].map(([task, items]) => (
						<section
							key={task}
							aria-label={task}
							className="flex flex-col gap-1"
						>
							<h2 className="text-muted-foreground text-xs">{task}</h2>
							{items.map((item) => (
								<Row
									key={item.message.id}
									item={item}
									onOpen={() =>
										setOpened({ task: item.task, id: item.message.id })
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
						id={current.message.id}
						details={snapshot.tasks.find((task) => task.task === current.task)}
						title={current.question?.text ?? current.subject}
						body={current.question?.body ?? ""}
					>
						<Opened item={current} onDone={() => setOpened(null)} />
					</ItemSheet>
				)}
			</Sheet>
			<Sheet open={writing} onOpenChange={setWriting}>
				{writing && (
					<NewMessage tasks={tasks} onDone={() => setWriting(false)} />
				)}
			</Sheet>
		</div>
	);
}

/** One thing sent on one line: its id, its subject, and where it stands. */
function Row({
	item,
	onOpen,
}: {
	item: Sent;
	onOpen: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onOpen}
			className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted"
		>
			<span className="w-7 shrink-0 text-muted-foreground text-xs tabular-nums">
				{item.message.id}
			</span>
			<span
				className={cn(
					"min-w-0 flex-1 truncate text-sm",
					// Acted on, so it steps back from what is still in play.
					item.state === "done" && "text-muted-foreground",
				)}
			>
				{plain(item.subject)}
			</span>
			<Status state={item.state} />
		</button>
	);
}

const STATUS: Record<
	SentState,
	{ Icon: LucideIcon; label: string; hint: string; className: string }
> = {
	waiting: {
		Icon: PencilLineIcon,
		label: "Waiting",
		hint: "Waiting for its agent: you can still change it",
		className: "text-warning",
	},
	editing: {
		Icon: PencilLineIcon,
		label: "Editing",
		hint: "Editing: its agent waits until you close this",
		className: "text-warning",
	},
	read: {
		Icon: CheckIcon,
		label: "Read",
		hint: "Read by its agent: follow it up to change anything",
		className: "text-success",
	},
	done: {
		Icon: CheckCheckIcon,
		label: "Done",
		hint: "Done: its agent has acted on it",
		className: "text-success",
	},
};

/**
 * Where something sent stands: a word and a colour in a row, the reason in
 * full once opened.
 */
function Status({
	state,
	full = false,
}: {
	state: SentState;
	full?: boolean;
}): JSX.Element {
	const { Icon, label, hint, className } = STATUS[state];
	return (
		<span
			title={hint}
			className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs"
		>
			<Icon className={cn("size-3.5", className)} />
			{full ? hint : label}
		</span>
	);
}

/**
 * Something sent, opened: to change while its agent has yet to read it, and
 * to follow up after.
 */
function Opened({
	item,
	onDone,
}: {
	item: Sent;
	onDone: () => void;
}): JSX.Element {
	const { task, message: sent, question } = item;
	if (item.state === "waiting" || item.state === "editing") {
		const isReply = question !== null && sent.id.startsWith("Q");
		return (
			<Held task={task} id={sent.id}>
				<div className="flex flex-col gap-3">
					<Status state="editing" full />
					<Composer
						task={task}
						question={question}
						initial={{
							choices: sent.choices,
							text: sent.text,
							keep: sent.files,
						}}
						label="Update"
						placeholder="@ for a file"
						send={(composed) =>
							isReply
								? reply({ task, question: sent.id, ...composed })
								: message({ task, id: sent.id, about: sent.about, ...composed })
						}
						withdraw={() => withdraw(task, sent.id)}
						onDone={onDone}
					/>
				</div>
			</Held>
		);
	}
	const picked =
		question?.choices
			.filter((choice) => sent.choices.includes(choice.key))
			.map((choice) => `${choice.key} (${choice.text})`) ?? [];
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
				<Status state={item.state} full />
				{picked.length > 0 && <p>{picked.join(", ")}</p>}
				{sent.text !== "" && (
					<p className="whitespace-pre-wrap break-words">{sent.text}</p>
				)}
				{sent.files.length > 0 && (
					<ul className="flex flex-wrap gap-2">
						{sent.files.map((path) => (
							<li key={path}>
								<a
									href={fileUrl(path)}
									target="_blank"
									rel="noreferrer"
									className="flex items-center gap-1 text-xs underline-offset-2 hover:underline"
								>
									<FileIcon className="size-3.5 text-muted-foreground" />
									{stored(path)}
								</a>
							</li>
						))}
					</ul>
				)}
			</div>
			<Composer
				// A fresh box after each follow-up goes.
				key={sent.id}
				task={task}
				label="Send"
				placeholder="Follow up, @ for a file"
				send={(composed) => message({ task, about: sent.id, ...composed })}
				onDone={onDone}
			/>
		</div>
	);
}

/** A message of its own to one task's agent. */
function NewMessage({
	tasks,
	onDone,
}: {
	tasks: string[];
	onDone: () => void;
}): JSX.Element {
	const [task, setTask] = useState(tasks.length === 1 ? (tasks[0] ?? "") : "");
	return (
		<SheetContent
			side="bottom"
			className="mx-auto max-h-[90dvh] max-w-2xl overflow-y-auto rounded-t-xl"
		>
			<SheetHeader>
				<SheetTitle>New message</SheetTitle>
			</SheetHeader>
			<div className="flex flex-col gap-4 px-4 pb-4">
				<ToggleGroup
					value={task === "" ? [] : [task]}
					onValueChange={(picked) => setTask((picked as string[])[0] ?? "")}
					orientation="vertical"
					variant="outline"
					className="w-full"
					aria-label="task"
				>
					{tasks.map((name) => (
						<ToggleGroupItem
							key={name}
							value={name}
							className="w-full justify-start"
						>
							{name}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
				{task !== "" && (
					<Composer
						key={task}
						task={task}
						label="Send"
						placeholder={`Tell ${task}'s agent, @ for a file`}
						send={(composed) => message({ task, ...composed })}
						onDone={onDone}
					/>
				)}
			</div>
		</SheetContent>
	);
}

/** Things sent by task, the task sent to most recently first. */
function group(sent: Sent[]): Map<string, Sent[]> {
	const byTask = new Map<string, Sent[]>();
	for (const item of sent) {
		byTask.set(item.task, [...(byTask.get(item.task) ?? []), item]);
	}
	return byTask;
}
