import {
	CircleDotIcon,
	CircleIcon,
	SquareCheckIcon,
	SquareIcon,
} from "lucide-react";
import { type JSX, type KeyboardEvent, useState } from "react";
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
import { AttachButton, FileList, useFiles } from "./files";
import { MentionAnchor, useMentions } from "./mentions";

/** What a person composed: picks, words and files. */
export interface Composed {
	choices: string[];
	text: string;
	/** Files to attach. */
	files: File[];
}

/**
 * A box to write a reply or a message in: the question's choices when it
 * offers them, words with `@` for a file, and attachments.
 */
export function Composer({
	task,
	question = null,
	label,
	placeholder,
	send,
	onDone,
}: {
	/** Whose tree `@` lists. */
	task: string;
	/** The question a reply answers, for its choices. */
	question?: Question | null;
	/** What the button says: `Send`, `Request changes`. */
	label: string;
	placeholder: string;
	send: (composed: Composed) => Promise<void>;
	onDone: () => void;
}): JSX.Element {
	const [choices, setChoices] = useState<string[]>([]);
	const [text, setText] = useState("");
	const files = useFiles([]);
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
		void run(() => send({ choices, text, files: files.files }), "Not sent");
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
						autoFocus={!offers}
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
		</div>
	);
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
