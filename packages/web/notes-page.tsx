import { useReactive } from "@webappwiz/react";
import { ArrowLeftIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { UuidProvider } from "webappwiz/id";
import { Button } from "#web/components/ui/button.tsx";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#web/components/ui/empty.tsx";
import { Field, FieldGroup, FieldLabel } from "#web/components/ui/field.tsx";
import { Textarea } from "#web/components/ui/textarea.tsx";
import { NEW, withDraft } from "./conversation-address";
import type { ConversationFeed } from "./conversation-feed";
import { type Drafts, newDraft } from "./drafts";
import { Markdown } from "./markdown";
import { NEW_NOTE, NotesReading } from "./notes-reading";
import { shownProject } from "./project-places";
import { TopBar } from "./top-bar";

const ids = new UuidProvider();

/** Read landed project notes and ask an agent to make changes. */
export function NotesPage({
	feed,
	drafts,
	onOpen,
}: {
	feed: ConversationFeed | null;
	drafts: Drafts;
	onOpen: (id: string) => void;
}): JSX.Element {
	const [reading] = useState(() => new NotesReading());
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
						run: () => {
							// A fresh conversation's own composer, with its model and
							// settings, seeded with what a note's agent is asked.
							const identity = ids.next();
							drafts.write(newDraft(shownProject(), null, identity), NEW_NOTE);
							onOpen(withDraft(NEW, identity));
						},
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
			{action !== null ? (
				<form
					className="flex max-w-2xl flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (feed !== null) {
							void reading.start(feed, onOpen);
						}
					}}
				>
					<h2 className="font-medium">
						{action === "edit" ? "Edit note" : "Remove note"}
					</h2>
					<p className="break-words text-sm">{note?.description}</p>
					<p className="text-muted-foreground text-sm">
						An agent will make this change in a task and land it after checks
						pass.
					</p>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="note-request">
								{action === "edit"
									? "What should change?"
									: "Why remove this note? (optional)"}
							</FieldLabel>
							<Textarea
								id="note-request"
								value={ask}
								onChange={(event) => reading.write(event.target.value)}
								required={action === "edit"}
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
							disabled={
								feed === null ||
								starting ||
								(action === "edit" && ask.trim() === "")
							}
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
						<Button variant="outline" onClick={() => reading.request("edit")}>
							Edit
						</Button>
						<Button variant="outline" onClick={() => reading.request("remove")}>
							Remove
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
							start a conversation that writes a note.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<ul className="flex max-w-3xl flex-col divide-y">
					{notes.map((note) => (
						<li key={note.path}>
							<button
								type="button"
								className="flex w-full flex-col gap-1 rounded-md px-2 py-4 text-left hover:bg-muted focus-visible:outline-ring"
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
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
