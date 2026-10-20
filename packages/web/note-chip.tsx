import { useReactive } from "@webappwiz/react";
import { BookOpenIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#web/components/ui/dialog.tsx";
import { Markdown } from "./markdown";
import { NoteReader } from "./note-reader";

/** A project note opens to read over the conversation, on this device. */
export function NoteChip({ path }: { path: string }): JSX.Element {
	const [open, setOpen] = useState(false);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger
				render={<Button variant="outline" size="xs" />}
				title={path}
				onClick={(event) => event.stopPropagation()}
				className="max-w-full align-middle"
			>
				<BookOpenIcon aria-hidden data-icon="inline-start" />
				<span className="truncate">{path.split("/").at(-1)}</span>
			</DialogTrigger>
			<DialogContent
				className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"
				onClick={(event) => event.stopPropagation()}
			>
				<DialogHeader>
					<DialogTitle className="break-all pr-8">
						{path.split("/").at(-1)}
					</DialogTitle>
				</DialogHeader>
				{open && <NoteBody path={path} />}
			</DialogContent>
		</Dialog>
	);
}

/** Load only the selected note, and let a missing note be closed like any other. */
function NoteBody({ path }: { path: string }): JSX.Element {
	const [reader] = useState(() => new NoteReader());
	const { note, error } = useReactive(
		reader,
		({ note, error }) => ({ note, error }),
		["changed"],
	);
	useEffect(() => {
		void reader.open(path);
		return () => reader.cancel();
	}, [reader, path]);
	return error !== null ? (
		<p role="alert">{error}</p>
	) : note === null ? (
		<p role="status">Loading note…</p>
	) : (
		<div className="min-w-0">
			<p className="mb-3 text-muted-foreground">{note.description}</p>
			<Markdown text={note.body} />
		</div>
	);
}
