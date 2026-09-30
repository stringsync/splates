import { ImagePlusIcon, InboxIcon, XIcon } from "lucide-react";
import {
	type ClipboardEvent,
	type JSX,
	type KeyboardEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Badge } from "#dev/components/ui/badge.tsx";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#dev/components/ui/collapsible.tsx";
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
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "#dev/components/ui/sheet.tsx";
import { toast } from "#dev/components/ui/toast.tsx";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "#dev/components/ui/toggle-group.tsx";
import type { OpenQuestion } from "../inbox";
import type { Snapshot } from "../snapshot";
import { reply } from "./api";
import { Markdown } from "./markdown";

/**
 * What waits on a person, and nothing else: each open question in a line, the
 * tags to answer one slice at a time, and the rest of a task only once a
 * question is opened.
 */
export function Inbox({ snapshot }: { snapshot: Snapshot }): JSX.Element {
	const { questions, tags } = snapshot.inbox;
	const [picked, setPicked] = useState<string[]>([]);
	const [opened, setOpened] = useState<OpenQuestion | null>(null);

	// Filtered here rather than by the server, so switching slices is instant;
	// a tag whose last question was answered simply drops out of the filter.
	const shown = useMemo(
		() =>
			picked.length === 0
				? questions
				: questions.filter((question) =>
						question.tags.some((tag) => picked.includes(tag)),
					),
		[questions, picked],
	);
	const byTask = useMemo(() => group(shown), [shown]);

	if (questions.length === 0) {
		return (
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
		);
	}

	return (
		<div className="flex flex-col gap-6">
			{tags.length > 0 && (
				<ToggleGroup
					multiple
					value={picked}
					onValueChange={(value) => setPicked(value as string[])}
					variant="outline"
					size="sm"
					className="flex-wrap"
					aria-label="filter by tag"
				>
					{tags.map(({ tag, count }) => (
						<ToggleGroupItem key={tag} value={tag}>
							{tag}
							<span className="text-muted-foreground tabular-nums">
								{count}
							</span>
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			)}
			{[...byTask].map(([task, open]) => (
				<section key={task} aria-label={task} className="flex flex-col gap-1">
					<h2 className="text-muted-foreground text-xs">{task}</h2>
					{open.map((question) => (
						<Row
							key={question.number}
							question={question}
							onOpen={() => setOpened(question)}
						/>
					))}
				</section>
			))}
			<Sheet
				open={opened !== null}
				onOpenChange={(open) => {
					if (!open) {
						setOpened(null);
					}
				}}
			>
				{opened && (
					<Answer
						question={opened}
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
			className="-mx-2 flex items-baseline gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted"
		>
			<span className="w-7 shrink-0 text-muted-foreground text-xs tabular-nums">
				{question.number}
			</span>
			<span className="line-clamp-2 flex-1 text-sm">
				{plain(question.text)}
			</span>
			{/* Answered here and not yet acted on: done from this side, so it steps
			    back rather than competing with what still needs an answer. */}
			{question.reply !== null && (
				<span className="shrink-0 text-muted-foreground text-xs">replied</span>
			)}
		</button>
	);
}

/** One question opened: all of it, the task it belongs to on demand, and a reply. */
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
	return (
		<SheetContent
			side="bottom"
			className="mx-auto max-h-[85dvh] max-w-2xl overflow-y-auto rounded-t-xl"
		>
			<SheetHeader>
				<SheetTitle className="flex items-center gap-2">
					{question.number}
					<span className="font-normal text-muted-foreground text-sm">
						{question.task}
					</span>
				</SheetTitle>
				<SheetDescription render={<div />}>
					<Markdown text={question.text} />
				</SheetDescription>
				{question.tags.length > 0 && (
					<div className="flex flex-wrap gap-1">
						{question.tags.map((tag) => (
							<Badge key={tag} variant="outline">
								{tag}
							</Badge>
						))}
					</div>
				)}
			</SheetHeader>
			<div className="flex flex-col gap-4 px-4 pb-4">
				{question.reply !== null && (
					<p className="text-muted-foreground text-sm">
						You replied: {question.reply}
					</p>
				)}
				{live ? (
					<p className="text-muted-foreground text-sm">
						Its agent is in a live session. Answer it in that chat.
					</p>
				) : (
					<ReplyBox question={question} onDone={onDone} />
				)}
				{task && (
					<Collapsible>
						<CollapsibleTrigger
							render={<Button variant="link" size="sm" className="px-0" />}
						>
							Show the task
						</CollapsibleTrigger>
						<CollapsibleContent className="flex flex-col gap-3 pt-2 text-sm">
							{task.escalation && (
								<p className="text-muted-foreground">{task.escalation}</p>
							)}
							{task.plan && (
								<Markdown
									text={task.plan.replace(/^\s*#\s[^\n]*/, "")}
									className="text-sm"
								/>
							)}
						</CollapsibleContent>
					</Collapsible>
				)}
			</div>
		</SheetContent>
	);
}

function ReplyBox({
	question,
	onDone,
}: {
	question: OpenQuestion;
	onDone: () => void;
}): JSX.Element {
	// A reply sent here already picked one: start from it, so sending again
	// changes the answer rather than dropping the choice.
	const [choice, setChoice] = useState<string | null>(question.chosen);
	const [text, setText] = useState("");
	const [images, setImages] = useState<File[]>([]);
	const [sending, setSending] = useState(false);
	const picker = useRef<HTMLInputElement>(null);

	const attach = (files: Iterable<File>) => {
		const added = [...files].filter((file) => file.type.startsWith("image/"));
		if (added.length > 0) {
			setImages((images) => [...images, ...added]);
		}
	};

	// A screenshot pasted from the clipboard arrives as a file with no useful
	// name, which is fine: the server keeps whatever it is given.
	const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
		const files = [...event.clipboardData.files];
		if (files.length > 0) {
			event.preventDefault();
			attach(files);
		}
	};

	// Words alone, a choice alone, or both: whichever the answer needs.
	const ready = choice !== null || text.trim() !== "" || images.length > 0;

	const send = async () => {
		if (!ready || sending) {
			return;
		}
		setSending(true);
		try {
			await reply({
				task: question.task,
				question: question.number,
				choice,
				text,
				images,
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
			{question.choices.length > 0 && (
				<ToggleGroup
					value={choice === null ? [] : [choice]}
					onValueChange={(value) => setChoice((value[0] as string) ?? null)}
					orientation="vertical"
					variant="outline"
					className="w-full"
					aria-label="choices"
				>
					{question.choices.map(({ key, text }) => (
						<ToggleGroupItem
							key={key}
							value={key}
							className="h-auto w-full justify-start gap-3 py-2 text-left whitespace-normal"
						>
							<span className="text-muted-foreground">{key}</span>
							{text}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			)}
			<InputGroup>
				<InputGroupTextarea
					aria-label="reply"
					placeholder={
						question.choices.length > 0 ? "Add context (optional)" : "Reply"
					}
					value={text}
					onChange={(event) => setText(event.target.value)}
					onPaste={paste}
					onKeyDown={keys}
					rows={question.choices.length > 0 ? 2 : 3}
					autoFocus={question.choices.length === 0}
				/>
				<InputGroupAddon align="block-end" className="justify-between">
					<InputGroupButton
						aria-label="attach an image"
						size="icon-xs"
						variant="ghost"
						onClick={() => picker.current?.click()}
					>
						<ImagePlusIcon />
					</InputGroupButton>
					<InputGroupButton
						variant="default"
						size="sm"
						disabled={!ready || sending}
						onClick={() => void send()}
					>
						Send
					</InputGroupButton>
				</InputGroupAddon>
			</InputGroup>
			<input
				ref={picker}
				type="file"
				accept="image/*"
				multiple
				hidden
				onChange={(event) => {
					attach(event.target.files ?? []);
					event.target.value = "";
				}}
			/>
			{images.length > 0 && (
				<div className="flex flex-wrap gap-2">
					{images.map((image, index) => (
						<Thumbnail
							key={`${image.name}-${image.size}-${image.lastModified}`}
							image={image}
							onRemove={() =>
								setImages((images) => images.filter((_, at) => at !== index))
							}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function Thumbnail({
	image,
	onRemove,
}: {
	image: File;
	onRemove: () => void;
}): JSX.Element {
	// Revoked when the thumbnail goes, or every pasted screenshot stays in memory
	// for as long as the page is open.
	const [url, setUrl] = useState<string>();
	useEffect(() => {
		const created = URL.createObjectURL(image);
		setUrl(created);
		return () => URL.revokeObjectURL(created);
	}, [image]);
	return (
		<div className="relative">
			<img
				src={url}
				alt={image.name}
				className="size-16 rounded-md border object-cover"
			/>
			<Button
				aria-label={`remove ${image.name}`}
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
	return text.replaceAll("`", "");
}
