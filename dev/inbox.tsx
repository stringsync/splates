import {
	CheckCheckIcon,
	CircleCheckIcon,
	CircleDotIcon,
	CircleIcon,
	FileIcon,
	InboxIcon,
	MessageCircleIcon,
	PanelRightIcon,
	PaperclipIcon,
	SquareCheckIcon,
	SquareIcon,
	XIcon,
} from "lucide-react";
import {
	type ClipboardEvent,
	type JSX,
	type KeyboardEvent,
	useEffect,
	useMemo,
	useRef,
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
import { toast } from "#dev/components/ui/toast.tsx";
import { Toggle } from "#dev/components/ui/toggle.tsx";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "#dev/components/ui/toggle-group.tsx";
import type { OpenQuestion } from "../inbox";
import type { Snapshot } from "../snapshot";
import { imageUrl, reply } from "./api";
import { Markdown } from "./markdown";
import { Task } from "./tasks";

/**
 * What waits on a person, and nothing else: each unanswered question in a
 * line, grouped by task. A question leaves once it is answered; the ones its
 * agent has yet to act on come back behind a toggle, to change or add to.
 */
export function Inbox({ snapshot }: { snapshot: Snapshot }): JSX.Element {
	const { questions } = snapshot.inbox;
	const [showReplied, setShowReplied] = useState(false);
	// By name rather than the object, so an open question keeps up with the
	// plan as it changes underneath.
	const [opened, setOpened] = useState<{
		task: string;
		number: string;
	} | null>(null);

	const replied = questions.filter((question) => question.reply !== null);
	const shown = useMemo(
		() =>
			showReplied
				? questions
				: questions.filter((question) => question.reply === null),
		[questions, showReplied],
	);
	const byTask = useMemo(() => group(shown), [shown]);
	const current =
		opened === null
			? undefined
			: questions.find(
					(question) =>
						question.task === opened.task && question.number === opened.number,
				);

	return (
		<div className="flex flex-col gap-6">
			{replied.length > 0 && (
				<div className="flex justify-end">
					<Toggle
						pressed={showReplied}
						onPressedChange={setShowReplied}
						variant="outline"
						size="sm"
						aria-label="show replied"
					>
						<CheckCheckIcon className="text-success" />
						Replied
						<span className="text-muted-foreground tabular-nums">
							{replied.length}
						</span>
					</Toggle>
				</div>
			)}
			{shown.length === 0 && (
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
			)}
			{[...byTask].map(([task, open]) => (
				<section key={task} aria-label={task} className="flex flex-col gap-1">
					<h2 className="text-muted-foreground text-xs">{task}</h2>
					{open.map((question) => (
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
						onDone={() => setOpened(null)}
					/>
				)}
			</Sheet>
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
			<span className="line-clamp-2 flex-1 text-sm">
				{plain(question.text)}
			</span>
			<Mark question={question} />
		</button>
	);
}

/** Answered, or waiting in a live chat: the two things a row may need to say. */
function Mark({ question }: { question: OpenQuestion }): JSX.Element | null {
	if (question.reply !== null) {
		return (
			<CircleCheckIcon
				role="img"
				aria-label="replied"
				className="size-4 shrink-0 text-success"
			/>
		);
	}
	if (question.lease === "held") {
		return (
			<MessageCircleIcon
				role="img"
				aria-label="answer it in its chat"
				className="size-4 shrink-0 text-warning"
			/>
		);
	}
	return null;
}

/** One question opened: all of it, a reply, and its task a tap away. */
function Answer({
	question,
	snapshot,
	onDone,
}: {
	question: OpenQuestion;
	snapshot: Snapshot;
	onDone: () => void;
}): JSX.Element {
	const task = snapshot.tasks.find((task) => task.task === question.task);
	const live = question.lease === "held";
	const image = (path: string, alt: string) => (
		<Lightbox src={imageUrl(question.task, path)} alt={alt || path} />
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
				{question.reply !== null && (
					<p className="flex gap-2 text-muted-foreground text-sm">
						<CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
						<span className="min-w-0 break-words">{question.reply}</span>
					</p>
				)}
				{live ? (
					<p className="flex gap-2 text-muted-foreground text-sm">
						<MessageCircleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
						Its agent is in a live session. Answer it in that chat.
					</p>
				) : (
					<ReplyBox question={question} onDone={onDone} />
				)}
			</div>
		</SheetContent>
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

function ReplyBox({
	question,
	onDone,
}: {
	question: OpenQuestion;
	onDone: () => void;
}): JSX.Element {
	// Start from the reply already sent, so sending again changes or adds to it
	// rather than starting over.
	const [choices, setChoices] = useState<string[]>(question.chosen);
	const [text, setText] = useState(() => words(question));
	const [files, setFiles] = useState<File[]>([]);
	const [sending, setSending] = useState(false);
	const picker = useRef<HTMLInputElement>(null);
	const offers = question.choices.length > 0;

	const attach = (added: Iterable<File>) => {
		const list = [...added];
		if (list.length > 0) {
			setFiles((files) => [...files, ...list]);
		}
	};

	// A screenshot pasted from the clipboard arrives as a file with no useful
	// name, which is fine: the server keeps whatever it is given.
	const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
		const pasted = [...event.clipboardData.files];
		if (pasted.length > 0) {
			event.preventDefault();
			attach(pasted);
		}
	};

	// Picks alone, words alone, or both: whichever the answer needs.
	const ready = choices.length > 0 || text.trim() !== "" || files.length > 0;

	const send = async () => {
		if (!ready || sending) {
			return;
		}
		setSending(true);
		try {
			await reply({
				task: question.task,
				question: question.number,
				choices,
				text,
				files,
			});
			toast.add({ title: `Replied to ${question.number}`, type: "success" });
			onDone();
		} catch (error) {
			toast.add({
				title: "Not sent",
				description: error instanceof Error ? error.message : String(error),
				type: "error",
			});
		} finally {
			setSending(false);
		}
	};

	const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			void send();
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
					onPaste={paste}
					onKeyDown={keys}
					rows={offers ? 2 : 3}
					autoFocus={!offers && question.reply === null}
				/>
				<InputGroupAddon align="block-end" className="justify-between">
					<InputGroupButton
						aria-label="attach files"
						size="icon-xs"
						variant="ghost"
						onClick={() => picker.current?.click()}
					>
						<PaperclipIcon />
					</InputGroupButton>
					<InputGroupButton
						variant="default"
						size="sm"
						disabled={!ready || sending}
						onClick={() => void send()}
					>
						{question.reply === null ? "Send" : "Update"}
					</InputGroupButton>
				</InputGroupAddon>
			</InputGroup>
			<input
				ref={picker}
				type="file"
				multiple
				hidden
				onChange={(event) => {
					attach(event.target.files ?? []);
					event.target.value = "";
				}}
			/>
			{files.length > 0 && (
				<div className="flex flex-wrap gap-2">
					{files.map((file, index) => (
						<Attached
							key={`${file.name}-${file.size}-${file.lastModified}`}
							file={file}
							onRemove={() =>
								setFiles((files) => files.filter((_, at) => at !== index))
							}
						/>
					))}
				</div>
			)}
		</div>
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

/** A file about to be sent: a thumbnail for an image, its name otherwise. */
function Attached({
	file,
	onRemove,
}: {
	file: File;
	onRemove: () => void;
}): JSX.Element {
	const image = file.type.startsWith("image/");
	// Revoked when the thumbnail goes, or every pasted screenshot stays in memory
	// for as long as the page is open.
	const [url, setUrl] = useState<string>();
	useEffect(() => {
		if (!image) {
			return;
		}
		const created = URL.createObjectURL(file);
		setUrl(created);
		return () => URL.revokeObjectURL(created);
	}, [file, image]);
	return (
		<div className="relative">
			{image ? (
				<img
					src={url}
					alt={file.name}
					className="size-16 rounded-md border object-cover"
				/>
			) : (
				<div className="flex h-16 max-w-40 items-center gap-2 rounded-md border px-3 text-xs">
					<FileIcon className="size-4 shrink-0 text-muted-foreground" />
					<span className="truncate">{file.name}</span>
				</div>
			)}
			<Button
				aria-label={`remove ${file.name}`}
				variant="secondary"
				size="icon-xs"
				className="absolute -top-2 -right-2 rounded-full"
				onClick={onRemove}
			>
				<XIcon />
			</Button>
		</div>
	);
}

/** The words of a reply already sent, after whatever it picked. */
function words(question: OpenQuestion): string {
	const { reply, chosen, choices } = question;
	if (reply === null) {
		return "";
	}
	const head = choices
		.filter((choice) => chosen.includes(choice.key))
		.map((choice) => `${choice.key} (${choice.text})`)
		.join(", ");
	return head !== "" && reply.startsWith(head)
		? reply.slice(head.length).replace(/^:\s*/, "")
		: chosen.length > 0
			? reply.replace(/^[a-z](?:,\s*[a-z])*:?\s*/, "")
			: reply;
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
