import {
	CircleDotIcon,
	CircleIcon,
	SquareCheckIcon,
	SquareIcon,
} from "lucide-react";
import {
	type JSX,
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useState,
} from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from "#dev/components/ui/input-group.tsx";
import { toast } from "#dev/components/ui/toast.tsx";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "#dev/components/ui/toggle-group.tsx";
import type { Question } from "../plan";
import { hold, release } from "./api";
import { AttachButton, FileList, useFiles } from "./files";
import { MentionAnchor, useMentions } from "./mentions";

/** How often something open to edit renews its hold, well inside `EDIT_MS`. */
const HOLD_EVERY_MS = 60_000;

/** What a person composed: picks, words and files. */
export interface Composed {
	choices: string[];
	text: string;
	/** New files to attach. */
	files: File[];
	/** Paths of files already stored to keep. */
	keep: string[];
}

/**
 * A box to write a reply or a message in: the question's choices when it
 * offers them, words with `@` for a file, and attachments. Starts from what
 * was sent before, so sending again changes it rather than starting over.
 */
export function Composer({
	task,
	question = null,
	initial,
	label,
	placeholder,
	send,
	onDone,
	withdraw,
}: {
	/** Whose tree `@` lists. */
	task: string;
	/** The question a reply answers, for its choices. */
	question?: Question | null;
	initial?: Partial<Composed>;
	/** What the button says: `Send`, `Update`. */
	label: string;
	placeholder: string;
	send: (composed: Composed) => Promise<void>;
	onDone: () => void;
	/** Takes back what was sent, when there is something to take back. */
	withdraw?: () => Promise<void>;
}): JSX.Element {
	const [choices, setChoices] = useState<string[]>(initial?.choices ?? []);
	const [text, setText] = useState(initial?.text ?? "");
	const files = useFiles(initial?.keep ?? []);
	const mentions = useMentions<HTMLTextAreaElement>({ task, text, setText });
	const [sending, setSending] = useState(false);
	const offers = (question?.choices.length ?? 0) > 0;

	// Picks alone, words alone, files alone, or any mix.
	const ready = choices.length > 0 || text.trim() !== "" || files.any;

	const run = async (write: () => Promise<void>, failed: string) => {
		setSending(true);
		try {
			await write();
			onDone();
		} catch (error) {
			toast.add({
				title: failed,
				description: error instanceof Error ? error.message : String(error),
				type: "error",
			});
			setSending(false);
		}
	};

	const submit = () => {
		if (!ready || sending) {
			return;
		}
		void run(
			() => send({ choices, text, files: files.files, keep: files.keep }),
			"Not sent",
		);
	};

	const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (mentions.onKeyDown(event)) {
			return;
		}
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			submit();
		}
	};

	return (
		<div className="flex flex-col gap-2">
			{question && offers && (
				<Choices question={question} value={choices} onChange={setChoices} />
			)}
			<MentionAnchor mentions={mentions}>
				<InputGroup>
					<InputGroupTextarea
						ref={mentions.ref}
						aria-label="message"
						placeholder={placeholder}
						value={text}
						onChange={mentions.onChange}
						onSelect={mentions.onSelect}
						onClick={mentions.onClick}
						onPaste={files.paste}
						onKeyDown={keys}
						rows={offers ? 2 : 3}
						autoFocus={!offers && initial === undefined}
					/>
					<InputGroupAddon align="block-end" className="justify-between">
						<AttachButton files={files} />
						<InputGroupButton
							variant="default"
							size="sm"
							disabled={!ready || sending}
							onClick={submit}
						>
							{label}
						</InputGroupButton>
					</InputGroupAddon>
				</InputGroup>
			</MentionAnchor>
			<FileList files={files} />
			{withdraw && (
				<Button
					variant="ghost"
					size="sm"
					className="self-start text-muted-foreground"
					disabled={sending}
					onClick={() => void run(withdraw, "Not withdrawn")}
				>
					Withdraw
				</Button>
			)}
		</div>
	);
}

/**
 * Something sent and not yet read, opened to change: held while open, so its
 * agent cannot read it half-edited, and let go on close. Shows `children` once
 * held, or why it could not be.
 */
export function Held({
	task,
	id,
	children,
}: {
	task: string;
	id: string;
	children: ReactNode;
}): JSX.Element {
	const [held, setHeld] = useState<"holding" | "held" | string>("holding");

	useEffect(() => {
		let live = true;
		const renewal = () =>
			hold(task, id).then(
				() => live && setHeld("held"),
				(error: unknown) =>
					live &&
					setHeld(error instanceof Error ? error.message : String(error)),
			);
		void renewal();
		const renew = setInterval(() => void renewal(), HOLD_EVERY_MS);
		return () => {
			live = false;
			clearInterval(renew);
			// Sent or not, the hold ends with the sheet. Sending already let go,
			// and letting go twice is harmless.
			void release(task, id).catch(() => undefined);
		};
	}, [task, id]);

	// A beat at most: the hold is one small write.
	if (held === "holding") {
		return <div className="h-24" />;
	}
	if (held !== "held") {
		return <p className="text-muted-foreground text-sm">{held}</p>;
	}
	return <>{children}</>;
}

/**
 * The answers a question offers. `(a)` ones take one or none: tapping the
 * picked one again unpicks it. `[a]` ones take any that apply.
 */
export function Choices({
	question,
	value,
	onChange,
}: {
	question: Question;
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
							<span className="min-w-0 flex-1">{text}</span>
							<span className="shrink-0 text-muted-foreground text-xs">
								{key}
							</span>
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
