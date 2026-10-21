import { useReactive } from "@webappwiz/react";
import type { JSX } from "react";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "#web/components/ui/alert.tsx";
import { Button } from "#web/components/ui/button.tsx";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "#web/components/ui/field.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { Textarea } from "#web/components/ui/textarea.tsx";
import type { NoteEditing } from "./note-editing";

/** Writes a note's filename, description and Markdown body, then lands it. */
export function NoteEditor({
	editing,
}: {
	editing: NoteEditing;
}): JSX.Element | null {
	const { draft, ready } = useReactive(
		editing,
		({ draft, ready }) => ({ draft, ready }),
		["changed"],
	);
	if (draft === null) {
		return null;
	}
	return (
		<form
			aria-label={draft.path === null ? "new note" : "edit note"}
			className="flex min-w-0 max-w-3xl flex-col gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				void editing.save();
			}}
		>
			<h2 className="font-medium">
				{draft.path === null ? "New note" : "Edit note"}
			</h2>
			<FieldGroup>
				<Field>
					<FieldLabel htmlFor="note-file">Filename</FieldLabel>
					<Input
						id="note-file"
						value={draft.file}
						placeholder="named-exports.md"
						autoCapitalize="off"
						autoCorrect="off"
						spellCheck={false}
						onChange={(event) => editing.write({ file: event.target.value })}
						required
					/>
				</Field>
				<Field>
					<FieldLabel htmlFor="note-description">Description</FieldLabel>
					<Input
						id="note-description"
						value={draft.description}
						onChange={(event) =>
							editing.write({ description: event.target.value })
						}
						required
					/>
					<FieldDescription>
						One line on what the note is about: agents find it by this alone.
					</FieldDescription>
				</Field>
				<Field>
					<FieldLabel htmlFor="note-body">Markdown</FieldLabel>
					<Textarea
						id="note-body"
						value={draft.body}
						className="min-h-72 font-mono text-sm"
						onChange={(event) => editing.write({ body: event.target.value })}
					/>
				</Field>
			</FieldGroup>
			<p className="text-muted-foreground text-sm">
				Saving lands the note on trunk as its own commit.
			</p>
			<div className="flex flex-wrap gap-2">
				<Button type="submit" disabled={!ready}>
					Save
				</Button>
				<Button
					type="button"
					variant="outline"
					onClick={() => editing.cancel()}
				>
					Cancel
				</Button>
			</div>
		</form>
	);
}

/** What the page shows of a change landing, or one that did not land, with its way to try again. */
export function NoteLanding({
	editing,
}: {
	editing: NoteEditing;
}): JSX.Element | null {
	const { pending, failure } = useReactive(
		editing,
		({ pending, failure }) => ({ pending, failure }),
		["changed"],
	);
	if (pending !== null) {
		return (
			<p role="status" className="text-muted-foreground text-sm">
				{pending.kind === "save"
					? `Saving ${pending.draft.file}…`
					: `Removing ${pending.note.path.split("/").pop()}…`}
			</p>
		);
	}
	if (failure === null) {
		return null;
	}
	const { change, why, conflict } = failure;
	const name =
		change.kind === "save"
			? change.draft.file
			: change.note.path.split("/").pop();
	return (
		<Alert variant="destructive" className="max-w-3xl">
			<AlertTitle>
				{change.kind === "save" ? "Not saved" : "Not removed"}: {name}
			</AlertTitle>
			<AlertDescription className="flex flex-col gap-3">
				<p className="break-words">{why}</p>
				<div className="flex flex-wrap gap-2">
					<Button
						size="sm"
						variant="outline"
						onClick={() => void editing.retry(false)}
					>
						Try again
					</Button>
					{conflict && (
						<Button
							size="sm"
							variant="destructive"
							onClick={() => void editing.retry(true)}
						>
							{change.kind === "save" ? "Save over it" : "Remove anyway"}
						</Button>
					)}
					<Button size="sm" variant="ghost" onClick={() => editing.dismiss()}>
						{change.kind === "save" ? "Back to editing" : "Dismiss"}
					</Button>
				</div>
			</AlertDescription>
		</Alert>
	);
}
