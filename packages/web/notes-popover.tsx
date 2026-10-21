import { BookOpenIcon, ChevronRightIcon } from "lucide-react";
import { type JSX, use, useState } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import { cn } from "#web/lib/utils.ts";
import { NamedContext } from "./mentioned";
import { NoteDialog } from "./note-chip";

/** A note in a `NotesPopover`, with what to say beside its name. */
export interface ListedPath {
	/** Whole, or from the project root. */
	path: string;
	/** Short words after its name, such as `in context`. */
	marks?: readonly string[];
}

/**
 * Some project notes as one quiet pill, `4 notes`, that opens to list each
 * by its name and description; a row opens the note to read over the
 * conversation. It stands in for a chip per note, which crowded the thread.
 */
export function NotesPopover({
	notes,
	title,
	className,
}: {
	notes: readonly ListedPath[];
	/** The list's heading, saying how the notes came to be there. */
	title: string;
	className?: string;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const [reading, setReading] = useState<string | null>(null);
	const { notes: listed = [], notesRoot, tree } = use(NamedContext);
	// The reader reads a note by its whole path; an event names it from the
	// project root.
	const root = notesRoot ?? tree;
	const whole = (path: string): string =>
		path.startsWith("/") || root === null ? path : `${root}/${path}`;
	// Notes sit flat in one directory, so a name finds one whatever root its
	// path was given from.
	const described = (path: string): string =>
		listed.find((note) => nameOf(note.path) === nameOf(path))?.description ??
		"";
	return (
		<>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger
					render={<button type="button" />}
					title={notes.map(({ path }) => path).join("\n")}
					onClick={(event) => event.stopPropagation()}
					className={cn(
						"inline-flex h-6 min-w-0 shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2 text-muted-foreground text-xs hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
						className,
					)}
				>
					<BookOpenIcon aria-hidden className="size-3.5 shrink-0" />
					{notes.length === 1 ? "1 note" : `${notes.length} notes`}
				</PopoverTrigger>
				<PopoverContent
					align="start"
					className="w-96 max-w-[calc(100vw-2rem)] gap-0 p-1.5"
					onClick={(event) => event.stopPropagation()}
				>
					<p className="px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">
						{title}
					</p>
					<ul aria-label={title}>
						{notes.map(({ path, marks = [] }) => (
							<li key={path}>
								<button
									type="button"
									className="flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
									onClick={() => {
										setOpen(false);
										setReading(whole(path));
									}}
								>
									<BookOpenIcon
										aria-hidden
										className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
									/>
									<span className="flex min-w-0 flex-1 flex-col">
										<span className="flex min-w-0 items-baseline gap-1.5">
											<span className="truncate font-medium text-sm">
												{nameOf(path)}
											</span>
											{marks.map((mark) => (
												<span
													key={mark}
													className="shrink-0 text-muted-foreground text-xs"
												>
													{mark}
												</span>
											))}
										</span>
										{described(path) !== "" && (
											<span className="truncate text-muted-foreground text-xs">
												{described(path)}
											</span>
										)}
									</span>
									<ChevronRightIcon
										aria-hidden
										className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
									/>
								</button>
							</li>
						))}
					</ul>
				</PopoverContent>
			</Popover>
			{reading !== null && (
				<NoteDialog
					path={reading}
					open
					onOpenChange={(next) => {
						if (!next) {
							setReading(null);
						}
					}}
				/>
			)}
		</>
	);
}

function nameOf(path: string): string {
	return path.split("/").at(-1) ?? path;
}
