import { useReactive } from "@webappwiz/react";
import { ArrowLeftIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#web/components/ui/empty.tsx";
import { Field, FieldGroup, FieldLabel } from "#web/components/ui/field.tsx";
import { Textarea } from "#web/components/ui/textarea.tsx";
import type { ConversationFeed } from "./conversation-feed";
import { GardenDraft } from "./garden-draft";
import { Markdown } from "./markdown";
import { NoteEditing } from "./note-editing";
import { NoteEditor, NoteLanding } from "./note-editor";
import { NotesReading } from "./notes-reading";
import { TopBar } from "./top-bar";

/** Read and write the project's notes, each save a commit on trunk, or ask an agent to change one. */
export function NotesPage({
	feed,
	onOpen,
}: {
	feed: ConversationFeed | null;
	onOpen: (id: string) => void;
}): JSX.Element {
	const [reading] = useState(() => new NotesReading());
	const [editing] = useState(() => new NoteEditing(reading));
	const { draft, pending } = useReactive(
		editing,
		({ draft, pending }) => ({ draft, pending }),
		["changed"],
	);
	const { notes, note, loading, error, action, ask, starting } = useReactive(
		reading,
		({ notes, note, loading, error, action, ask, starting }) => ({
			notes,
			note,
			loading,
			error,
			action,
			ask,
			starting,
		}),
		["changed"],
	);
	useEffect(() => {
		void reading.refresh();
	}, [reading]);
	return (
		<section aria-label="notes" className="flex min-w-0 flex-col gap-6">
			<TopBar
				title="Notes"
				actions={[
					{
						label: "New note",
						icon: <PlusIcon />,
						text: "New",
						run: () => editing.begin(null),
					},
					{
						label: "Refresh notes",
						icon: <RefreshCwIcon />,
						run: () => {
							void reading.refresh();
						},
					},
				]}
			/>
			{error !== null && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
			<NoteLanding editing={editing} />
			{draft !== null ? (
				<NoteEditor editing={editing} />
			) : pending?.kind === "save" ? (
				<article className="flex min-w-0 max-w-3xl flex-col gap-4 opacity-70">
					<h2 className="break-words font-medium">
						{pending.draft.description}
					</h2>
					<Markdown
						text={pending.draft.body}
						className="min-w-0 break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto"
					/>
				</article>
			) : action !== null ? (
				<form
					className="flex max-w-2xl flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (feed !== null) {
							void reading.start(feed, onOpen);
						}
					}}
				>
					<h2 className="font-medium">Ask an agent</h2>
					<p className="break-words text-sm">{note?.description}</p>
					<p className="text-muted-foreground text-sm">
						An agent will make this change in a task and land it after checks
						pass.
					</p>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="note-request">
								What should change?
							</FieldLabel>
							<Textarea
								id="note-request"
								value={ask}
								onChange={(event) => reading.write(event.target.value)}
								required
								disabled={starting}
							/>
						</Field>
					</FieldGroup>
					{feed === null && (
						<p className="text-muted-foreground text-sm">
							Connect an agent to request a change.
						</p>
					)}
					<div className="flex flex-wrap gap-2">
						<Button
							type="submit"
							disabled={feed === null || starting || ask.trim() === ""}
						>
							{starting ? "Starting…" : "Start conversation"}
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={starting}
							onClick={() => reading.request(null)}
						>
							Cancel
						</Button>
					</div>
				</form>
			) : loading ? (
				<p role="status" className="text-muted-foreground text-sm">
					Loading notes…
				</p>
			) : note !== null ? (
				<article className="flex min-w-0 max-w-3xl flex-col gap-4">
					<div className="flex flex-wrap gap-2">
						<Button variant="ghost" onClick={() => reading.back()}>
							<ArrowLeftIcon data-icon="inline-start" />
							All notes
						</Button>
						<Button
							variant="outline"
							disabled={pending !== null}
							onClick={() => editing.begin(note)}
						>
							Edit
						</Button>
						<Button
							variant="outline"
							disabled={pending !== null}
							onClick={() => void editing.remove(note)}
						>
							Remove
						</Button>
						<Button variant="ghost" onClick={() => reading.request("edit")}>
							Ask an agent
						</Button>
					</div>
					<h2 className="break-words font-medium">{note.description}</h2>
					<p className="break-all text-muted-foreground text-xs">{note.path}</p>
					<Markdown
						text={note.body}
						className="min-w-0 break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto"
					/>
				</article>
			) : notes.length === 0 && error === null ? (
				<Empty>
					<EmptyHeader>
						<EmptyTitle>No project notes yet</EmptyTitle>
						<EmptyDescription>
							Keep the project's conventions and decisions here. Use New to
							write a note.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<>
					<GardenDraft feed={feed} onOpen={onOpen} />
					<ul className="flex max-w-3xl flex-col divide-y">
						{notes.map((note) => (
							<li key={note.path}>
								<button
									type="button"
									className="flex w-full flex-col gap-0.5 rounded-md px-3 py-4 text-left transition-colors hover:bg-muted focus-visible:outline-ring"
									onClick={() => {
										void reading.open(note.path);
									}}
								>
									<span className="break-words font-medium text-sm">
										{note.description}
									</span>
									<span className="break-all text-muted-foreground text-xs">
										{note.path}
									</span>
									<span className="mt-1 flex flex-wrap gap-1.5">
										<span
											className={
												note.uses === 0
													? "rounded-full bg-destructive/10 px-2 py-0.5 text-destructive text-xs"
													: "rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs"
											}
										>
											{note.uses === 0
												? "Never read"
												: `Read in ${note.uses} ${note.uses === 1 ? "conversation" : "conversations"}`}
										</span>
										<span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
											{`Recommended ${note.recommended} ${note.recommended === 1 ? "time" : "times"}, followed ${note.followed}`}
										</span>
									</span>
								</button>
							</li>
						))}
					</ul>
				</>
			)}
		</section>
	);
}
