import { useReactive } from "@webappwiz/react";
import { PlusIcon, XIcon } from "lucide-react";
import {
	type FormEvent,
	type JSX,
	type KeyboardEvent,
	useContext,
	useState,
} from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { Board } from "./board";
import { type Drafts, todoDraft } from "./drafts";
import { AttachButton, Dropped, FileList } from "./files";
import { MentionAnchor, useMentions } from "./mentions";
import { Refusal, useRefusal } from "./refusal";
import { TodoDraft } from "./todo-draft";

/**
 * "Add a todo" at the foot of a column, opening into a box for its subject,
 * the way Trello adds a card: Enter adds it at the bottom of the column and
 * leaves the box open for the next, Escape puts it away. `@` names a file
 * in the repo, and a pasted or attached file goes with it.
 */
export function AddTodo({ lane }: { lane: number | null }): JSX.Element {
	const { drafts } = useContext(Board);
	const key = todoDraft(
		new URLSearchParams(location.search).get("project"),
		lane,
	);
	// Open on a draft kept from before, so coming back shows what was typed.
	const [open, setOpen] = useState(() => drafts.read(key) !== "");
	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-muted-foreground text-sm outline-none hover:bg-background/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
			>
				<PlusIcon aria-hidden className="size-4" />
				Add a todo
			</button>
		);
	}
	return (
		<Composer
			lane={lane}
			draft={key}
			drafts={drafts}
			onClose={() => setOpen(false)}
		/>
	);
}

function Composer({
	lane,
	draft: key,
	drafts,
	onClose,
}: {
	lane: number | null;
	/** Where in `drafts` what is typed is kept. */
	draft: string;
	drafts: Drafts;
	onClose: () => void;
}): JSX.Element {
	const [draft] = useState(() => new TodoDraft(drafts, key));
	const { ready, dropped } = useReactive(
		draft,
		(draft) => ({ ready: draft.ready, dropped: draft.dropped }),
		["changed"],
	);
	const subject = useMentions<HTMLTextAreaElement>(draft.subject);
	const { refusal, attempt } = useRefusal();

	const submit = (event?: FormEvent) => {
		event?.preventDefault();
		void attempt(draft.add(lane), "Not added").then(() =>
			subject.ref.current?.focus(),
		);
	};
	const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		subject.onKeyDown(event);
		if (event.defaultPrevented) {
			return; // the file list took it
		}
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			submit();
		} else if (event.key === "Escape") {
			onClose();
		}
	};
	return (
		<form onSubmit={submit} className="flex flex-col gap-2">
			<MentionAnchor mentions={subject}>
				<textarea
					ref={subject.ref}
					// biome-ignore lint/a11y/noAutofocus: it opens because "Add a todo" was just pressed, to type one
					autoFocus
					aria-label="new todo"
					placeholder="Enter a title for this todo, @ for a file"
					rows={3}
					value={subject.value}
					onChange={subject.onChange}
					onSelect={subject.onSelect}
					onClick={subject.onClick}
					onKeyDown={keys}
					onPaste={(event) => draft.files.paste(event)}
					className="w-full resize-none rounded-lg border bg-card px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
				/>
			</MentionAnchor>
			<FileList files={draft.files} />
			<Dropped names={dropped} />
			<Refusal refusal={refusal} />
			<div className="flex items-center gap-1">
				<Button type="submit" size="sm" disabled={!ready}>
					Add todo
				</Button>
				<Button
					type="button"
					size="icon-sm"
					variant="ghost"
					aria-label="stop adding"
					onClick={onClose}
				>
					<XIcon />
				</Button>
				<span className="ml-auto">
					<AttachButton files={draft.files} />
				</span>
			</div>
		</form>
	);
}
