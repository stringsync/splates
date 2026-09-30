import {
	CheckCheckIcon,
	CircleDotIcon,
	CircleIcon,
	InboxIcon,
	type LucideIcon,
	MessageCircleIcon,
	PanelRightIcon,
	PencilLineIcon,
	SquareCheckIcon,
	SquareIcon,
} from "lucide-react";
import {
	type JSX,
	type KeyboardEvent,
	useEffect,
	useMemo,
	useState,
} from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogTitle,
	DialogTrigger,
} from "#dev/components/ui/dialog.tsx";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "#dev/components/ui/empty.tsx";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from "#dev/components/ui/input-group.tsx";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "#dev/components/ui/sheet.tsx";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#dev/components/ui/tabs.tsx";
import { toast } from "#dev/components/ui/toast.tsx";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "#dev/components/ui/toggle-group.tsx";
import type { OpenQuestion, QuestionState } from "../inbox";
import type { Snapshot } from "../snapshot";
import { fileUrl, holdReply, releaseReply, reply, unreply } from "./api";
import { AttachButton, FileList, useFiles } from "./files";
import { Markdown } from "./markdown";
import { Task } from "./tasks";

/** How often an open reply renews its hold, well inside `EDIT_MS`. */
const HOLD_EVERY_MS = 60_000;

/** A question by name, rather than the object, so it keeps up with the plan. */
interface Named {
	task: string;
	number: string;
}

/**
 * What waits on a person: the questions with no reply yet, grouped by task.
 * Once answered, a question moves to Replied, where it can still be changed
 * until its agent reads it.
 */
export function Inbox({ snapshot }: { snapshot: Snapshot }): JSX.Element {
	const { questions } = snapshot.inbox;
	const [opened, setOpened] = useState<Named | null>(null);

	const open = useMemo(
		() => questions.filter((question) => question.state === "open"),
		[questions],
	);
	const replied = useMemo(
		() => questions.filter((question) => question.state !== "open"),
		[questions],
	);
	const current =
		opened === null
			? undefined
			: questions.find(
					(question) =>
						question.task === opened.task && question.number === opened.number,
				);
	const openOne = (question: OpenQuestion) =>
		setOpened({ task: question.task, number: question.number });

	return (
		<Tabs defaultValue="open" className="gap-4">
			<TabsList className="w-full">
				<TabsTrigger value="open">
					Open
					<Count>{open.length}</Count>
				</TabsTrigger>
				<TabsTrigger value="replied">
					Replied
					<Count>{replied.length}</Count>
				</TabsTrigger>
			</TabsList>
			<TabsContent value="open">
				{open.length === 0 ? (
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
					<Groups questions={open} onOpen={openOne} />
				)}
			</TabsContent>
			<TabsContent value="replied">
				{replied.length === 0 ? (
					<Empty>
						<EmptyHeader>
							<EmptyTitle>No replies waiting</EmptyTitle>
							<EmptyDescription>
								What you answer waits here until its agent acts on it.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<Groups questions={replied} onOpen={openOne} />
				)}
			</TabsContent>
			<Sheet
				open={current !== undefined}
				onOpenChange={(open) => {
					if (!open) {
						setOpened(null);
					}
				}}
			>
				{current && (
					<Answer
						question={current}
						snapshot={snapshot}
						onSent={() => setOpened(null)}
					/>
				)}
			</Sheet>
		</Tabs>
	);
}

function Count({ children }: { children: number }): JSX.Element | null {
	return children === 0 ? null : (
		<span className="text-muted-foreground tabular-nums">{children}</span>
	);
}

function Groups({
	questions,
	onOpen,
}: {
	questions: OpenQuestion[];
	onOpen: (question: OpenQuestion) => void;
}): JSX.Element {
	return (
		<div className="flex flex-col gap-6">
			{[...group(questions)].map(([task, asked]) => (
				<section key={task} aria-label={task} className="flex flex-col gap-1">
					<h2 className="text-muted-foreground text-xs">{task}</h2>
					{asked.map((question) => (
						<Row
							key={question.number}
							question={question}
							onOpen={() => onOpen(question)}
						/>
					))}
				</section>
			))}
		</div>
	);
}

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
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="line-clamp-2 text-sm">{plain(question.text)}</span>
				{question.state !== "open" && <Status state={question.state} />}
			</span>
			{question.state === "open" && question.lease === "held" && (
				<MessageCircleIcon
					role="img"
					aria-label="answer it in its chat"
					className="size-4 shrink-0 text-warning"
				/>
			)}
		</button>
	);
}

const STATUS: Record<
	Exclude<QuestionState, "open">,
	{ Icon: LucideIcon; label: string; className: string }
> = {
	replied: {
		Icon: PencilLineIcon,
		label: "Waiting for its agent, still editable",
		className: "text-warning",
	},
	editing: {
		Icon: PencilLineIcon,
		label: "Being edited, so its agent waits",
		className: "text-warning",
	},
	read: {
		Icon: CheckCheckIcon,
		label: "Read by its agent",
		className: "text-success",
	},
};

/** Where a replied question stands, in a word and a colour. */
function Status({
	state,
}: {
	state: Exclude<QuestionState, "open">;
}): JSX.Element {
	const { Icon, label, className } = STATUS[state];
	return (
		<span className="flex items-center gap-1 text-muted-foreground text-xs">
			<Icon className={`size-3.5 ${className}`} />
			{label}
		</span>
	);
}

/** One question opened: all of it, a reply, and its task a tap away. */
function Answer({
	question,
	snapshot,
	onSent,
}: {
	question: OpenQuestion;
	snapshot: Snapshot;
	onSent: () => void;
}): JSX.Element {
	const task = snapshot.tasks.find((task) => task.task === question.task);
	const image = (path: string, alt: string) => (
		<Lightbox src={fileUrl(path, question.task)} alt={alt || path} />
	);
	return (
		<SheetContent
			side="bottom"
			className="mx-auto max-h-[90dvh] max-w-2xl overflow-y-auto rounded-t-xl"
		>
			<SheetHeader className="pr-12">
				<div className="flex items-center gap-2 text-muted-foreground text-xs">
					<span className="tabular-nums">{question.number}</span>
					<span className="truncate">{question.task}</span>
					{task && (
						// Over the question rather than in place of it: closing the
						// task comes back here, reply and all.
						<Sheet>
							<SheetTrigger
								render={
									<Button variant="ghost" size="xs" className="-my-1 ml-auto" />
								}
							>
								<PanelRightIcon data-icon="inline-start" />
								Task
							</SheetTrigger>
							<Task task={task} side="right" />
						</Sheet>
					)}
				</div>
				<SheetTitle>
					<Markdown text={question.text} image={image} />
				</SheetTitle>
			</SheetHeader>
			<div className="flex flex-col gap-4 px-4 pb-4">
				{question.body !== "" && (
					<Markdown text={question.body} image={image} className="text-sm" />
				)}
				<Respond question={question} onSent={onSent} />
			</div>
		</SheetContent>
	);
}

/** What can be done about the question from here, given where it stands. */
function Respond({
	question,
	onSent,
}: {
	question: OpenQuestion;
	onSent: () => void;
}): JSX.Element {
	if (question.state === "read") {
		return (
			<div className="flex flex-col gap-2 text-sm">
				<Status state="read" />
				<p className="break-words">{question.reply}</p>
				<p className="text-muted-foreground text-xs">
					It can no longer change here. If it needs to, tell the agent in its
					chat.
				</p>
			</div>
		);
	}
	if (question.lease === "held") {
		return (
			<p className="flex gap-2 text-muted-foreground text-sm">
				<MessageCircleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
				Its agent is in a live session. Answer it in that chat.
			</p>
		);
	}
	if (question.state === "open") {
		return <ReplyBox question={question} onSent={onSent} />;
	}
	return <Edit question={question} onSent={onSent} />;
}

/**
 * A reply not yet read, opened to change: held while open, so its agent
 * cannot read it half-edited, and let go on close.
 */
function Edit({
	question,
	onSent,
}: {
	question: OpenQuestion;
	onSent: () => void;
}): JSX.Element {
	const [held, setHeld] = useState<"holding" | "held" | string>("holding");
	const { task, number } = question;

	useEffect(() => {
		let live = true;
		const hold = () =>
			holdReply(task, number).then(
				() => live && setHeld("held"),
				(error: unknown) =>
					live &&
					setHeld(error instanceof Error ? error.message : String(error)),
			);
		void hold();
		const renew = setInterval(() => void hold(), HOLD_EVERY_MS);
		return () => {
			live = false;
			clearInterval(renew);
			// Sent or not, the hold ends with the sheet. Sending already let go,
			// and letting go twice is harmless.
			void releaseReply(task, number).catch(() => undefined);
		};
	}, [task, number]);

	// A beat at most: the hold is one small write.
	if (held === "holding") {
		return <div className="h-24" />;
	}
	if (held !== "held") {
		return <p className="text-muted-foreground text-sm">{held}</p>;
	}
	return (
		<div className="flex flex-col gap-3">
			<Status state="editing" />
			<ReplyBox question={question} onSent={onSent} />
		</div>
	);
}

function ReplyBox({
	question,
	onSent,
}: {
	question: OpenQuestion;
	onSent: () => void;
}): JSX.Element {
	// Start from the reply waiting, so sending again changes it rather than
	// starting over.
	const pending = question.pending;
	const [choices, setChoices] = useState<string[]>(pending?.choices ?? []);
	const [text, setText] = useState(pending?.text ?? "");
	const files = useFiles(pending?.files ?? []);
	const [sending, setSending] = useState(false);
	const offers = question.choices.length > 0;

	// Picks alone, words alone, files alone, or any mix.
	const ready = choices.length > 0 || text.trim() !== "" || files.any;

	const run = async (write: () => Promise<void>, failed: string) => {
		setSending(true);
		try {
			await write();
			onSent();
		} catch (error) {
			toast.add({
				title: failed,
				description: error instanceof Error ? error.message : String(error),
				type: "error",
			});
			setSending(false);
		}
	};

	const send = () => {
		if (!ready || sending) {
			return;
		}
		void run(
			() =>
				reply({
					task: question.task,
					question: question.number,
					choices,
					text,
					files: files.files,
					keep: files.keep,
				}),
			"Not sent",
		);
	};

	const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			send();
		}
	};

	return (
		<div className="flex flex-col gap-2">
			{offers && (
				<Choices question={question} value={choices} onChange={setChoices} />
			)}
			<InputGroup>
				<InputGroupTextarea
					aria-label="reply"
					placeholder={offers ? "Add context (optional)" : "Reply"}
					value={text}
					onChange={(event) => setText(event.target.value)}
					onPaste={files.paste}
					onKeyDown={keys}
					rows={offers ? 2 : 3}
					autoFocus={!offers && pending === null}
				/>
				<InputGroupAddon align="block-end" className="justify-between">
					<AttachButton files={files} />
					<InputGroupButton
						variant="default"
						size="sm"
						disabled={!ready || sending}
						onClick={send}
					>
						{pending === null ? "Send" : "Update"}
					</InputGroupButton>
				</InputGroupAddon>
			</InputGroup>
			<FileList files={files} />
			{pending !== null && (
				<Button
					variant="ghost"
					size="sm"
					className="self-start text-muted-foreground"
					disabled={sending}
					onClick={() =>
						void run(
							() => unreply(question.task, question.number),
							"Not withdrawn",
						)
					}
				>
					Withdraw the reply
				</Button>
			)}
		</div>
	);
}

/** An image a question shows: a thumbnail that opens full size. */
function Lightbox({ src, alt }: { src: string; alt: string }): JSX.Element {
	return (
		<Dialog>
			<DialogTrigger
				render={
					<button
						type="button"
						className="my-1 block overflow-hidden rounded-md border"
					/>
				}
			>
				<img src={src} alt={alt} className="max-h-48 w-auto object-contain" />
			</DialogTrigger>
			<DialogContent className="max-w-[95vw] p-2 sm:max-w-[95vw]">
				<DialogTitle className="sr-only">{alt}</DialogTitle>
				<img
					src={src}
					alt={alt}
					className="max-h-[85dvh] w-full rounded-md object-contain"
				/>
			</DialogContent>
		</Dialog>
	);
}

/**
 * The answers a question offers. `(a)` ones take one or none: tapping the
 * picked one again unpicks it. `[a]` ones take any that apply.
 */
function Choices({
	question,
	value,
	onChange,
}: {
	question: OpenQuestion;
	value: string[];
	onChange: (value: string[]) => void;
}): JSX.Element {
	const any = question.pick === "any";
	const [On, Off] = any
		? [SquareCheckIcon, SquareIcon]
		: [CircleDotIcon, CircleIcon];
	return (
		<div className="flex flex-col gap-1.5">
			<ToggleGroup
				multiple={any}
				value={value}
				onValueChange={(picked) => onChange(picked as string[])}
				orientation="vertical"
				variant="outline"
				className="w-full"
				aria-label="choices"
			>
				{question.choices.map(({ key, text }) => {
					const Icon = value.includes(key) ? On : Off;
					return (
						<ToggleGroupItem
							key={key}
							value={key}
							className="h-auto w-full justify-start gap-3 py-2 text-left whitespace-normal"
						>
							<Icon
								className={
									value.includes(key) ? "text-primary" : "text-muted-foreground"
								}
							/>
							<span className="flex-1">{text}</span>
							<span className="text-muted-foreground text-xs">{key}</span>
						</ToggleGroupItem>
					);
				})}
			</ToggleGroup>
			<p className="text-muted-foreground text-xs">
				{any ? "Pick any that apply." : "Pick one, or none."}
			</p>
		</div>
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

/** A line of markdown as it reads, for a row too short to render it. */
function plain(text: string): string {
	return text.replaceAll("`", "").replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
}
