import { useReactive } from "@webappwiz/react";
import { BookOpenIcon, CheckIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#web/components/ui/dialog.tsx";
import { cn } from "#web/lib/utils.ts";
import { Markdown } from "./markdown";
import { NoteReader } from "./note-reader";

/**
 * A project note opens to read over the conversation, on this device. On a
 * message it was attached to, `tier` makes it solid when the agent was told
 * to read it and outlined when only pointed to; `inContext` dims it, the
 * agent holding it already, and `updated` marks one re-attached for an edit.
 */
export function NoteChip({
	path,
	tier = "optional",
	inContext = false,
	updated = false,
}: {
	path: string;
	tier?: "now" | "optional";
	inContext?: boolean;
	updated?: boolean;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger
				render={
					<Button
						variant={tier === "now" && !inContext ? "secondary" : "outline"}
						size="xs"
					/>
				}
				title={inContext ? `${path} (in context)` : path}
				onClick={(event) => event.stopPropagation()}
				className={cn("max-w-full align-middle", inContext && "opacity-60")}
			>
				{inContext ? (
					<CheckIcon aria-hidden data-icon="inline-start" />
				) : (
					<BookOpenIcon aria-hidden data-icon="inline-start" />
				)}
				<span className="truncate">{path.split("/").at(-1)}</span>
				{inContext && <span className="text-muted-foreground">in context</span>}
				{updated && <span className="text-muted-foreground">updated</span>}
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
