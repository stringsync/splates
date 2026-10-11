import {
	ChevronsDownUpIcon,
	ChevronsUpDownIcon,
	RotateCwIcon,
	XIcon,
} from "lucide-react";
import { createContext, type JSX, useEffect, useState } from "react";
import { CodeDiff } from "#dev/components/assistant-ui/elements/code-diff.tsx";
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { FileDiff } from "../diff";
import { taskDiff } from "./api";

/** What a status says beside a file's path; a change in place says nothing. */
const STATUS: Record<FileDiff["status"], string | null> = {
	added: "new",
	deleted: "deleted",
	renamed: "moved",
	modified: null,
};

/** Opens a task's changes in the pane beside the page; null where there is none. */
export const ReviewChanges = createContext<((task: string) => void) | null>(
	null,
);

/** How wide the pane is, which the page leaves clear beside it. */
export const PANE_WIDTH = "w-[min(48rem,50vw)]";
export const BESIDE_PANE = "pr-[min(48rem,50vw)]";

/**
 * Everything `task` changed against its base, uncommitted work included, in
 * a pane down the right of the page (the whole screen on a phone): a file to
 * a line, each opening to its hunks, or all of them at once. Read again
 * whenever `version` moves, or on Reload; Escape closes it.
 */
export function ChangesPane({
	task,
	version,
	phone,
	onClose,
}: {
	task: string;
	/** Anything that moves when the task's diff may have. */
	version: string;
	phone: boolean;
	onClose: () => void;
}): JSX.Element {
	const [files, setFiles] = useState<FileDiff[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [reads, setReads] = useState(0);
	const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
	const allOpen =
		files !== null &&
		files.length > 0 &&
		files.every((file) => opened.has(file.path));
	useEffect(() => {
		const close = (event: globalThis.KeyboardEvent) => {
			// A dialog or menu open over the page takes its Escape first.
			if (
				event.key === "Escape" &&
				!event.defaultPrevented &&
				document.querySelector('[role="dialog"], [role="menu"]') === null
			) {
				onClose();
			}
		};
		document.addEventListener("keydown", close);
		return () => document.removeEventListener("keydown", close);
	}, [onClose]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `version` and `reads` are the signals to read again
	useEffect(() => {
		let current = true;
		taskDiff(task).then(
			(read) => {
				if (current) {
					setFiles(read);
					setError(null);
				}
			},
			(failed: unknown) => current && setError(String(failed)),
		);
		return () => {
			current = false;
		};
	}, [task, version, reads]);

	return (
		<aside
			aria-label={`changes in ${task}`}
			className={cn(
				"fixed z-40 flex flex-col overflow-y-auto bg-background text-sm",
				phone ? "inset-0" : cn("inset-y-0 right-0 border-l", PANE_WIDTH),
			)}
		>
			<header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-4 py-3">
				<h2 className="min-w-0 flex-1 truncate font-medium">
					Changes in {task}
				</h2>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Reload"
					title="Read the diff again"
					onClick={() => setReads((count) => count + 1)}
				>
					<RotateCwIcon />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Close changes"
					onClick={onClose}
				>
					<XIcon />
				</Button>
			</header>
			<div className="flex flex-col gap-2 px-4 py-3">
				{error !== null ? (
					<p className="text-destructive">{error}</p>
				) : files === null ? (
					<p className="text-muted-foreground">Reading the diff…</p>
				) : files.length === 0 ? (
					<p className="text-muted-foreground">No changes yet.</p>
				) : (
					<>
						<div className="flex items-center justify-between gap-2">
							<p className="text-muted-foreground text-xs">
								{files.length} file{files.length === 1 ? "" : "s"}
							</p>
							<Button
								variant="ghost"
								size="xs"
								onClick={() =>
									setOpened(
										allOpen
											? new Set()
											: new Set(files.map((file) => file.path)),
									)
								}
							>
								{allOpen ? <ChevronsDownUpIcon /> : <ChevronsUpDownIcon />}
								{allOpen ? "Collapse all" : "Expand all"}
							</Button>
						</div>
						<ul className="flex flex-col gap-1">
							{files.map((file) => (
								<li key={file.path}>
									<File
										file={file}
										open={opened.has(file.path)}
										onOpen={(open) =>
											setOpened((was) => {
												const now = new Set(was);
												if (open) {
													now.add(file.path);
												} else {
													now.delete(file.path);
												}
												return now;
											})
										}
									/>
								</li>
							))}
						</ul>
					</>
				)}
			</div>
		</aside>
	);
}

function File({
	file,
	open,
	onOpen,
}: {
	file: FileDiff;
	open: boolean;
	onOpen: (open: boolean) => void;
}): JSX.Element {
	const status = STATUS[file.status];
	return (
		<details
			open={open}
			onToggle={(event) => {
				// Fires for the pane's own Expand all too, which is already in step.
				if (event.currentTarget.open !== open) {
					onOpen(event.currentTarget.open);
				}
			}}
			className="group/file"
		>
			<summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1 font-mono text-xs hover:bg-muted focus-visible:bg-muted focus-visible:outline-none [&::-webkit-details-marker]:hidden">
				<span className="min-w-0 flex-1 truncate" title={file.path}>
					{file.from === null ? file.path : `${file.from} → ${file.path}`}
				</span>
				{status !== null && (
					<span className="text-muted-foreground">{status}</span>
				)}
				{file.uncommitted && (
					<span
						title="Some of it is not committed yet"
						className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 text-[11px] text-amber-600 leading-4 dark:text-amber-400"
					>
						uncommitted
					</span>
				)}
				<span className="shrink-0 tabular-nums">
					<span className="text-success">+{file.added}</span>{" "}
					<span className="text-destructive">−{file.removed}</span>
				</span>
			</summary>
			<div className="mt-1 mb-3 flex flex-col gap-2">
				{file.binary ? (
					<p className="px-2 text-muted-foreground text-xs">
						A binary file: no lines to show.
					</p>
				) : (
					file.hunks.map((hunk) => (
						<CodeDiff
							key={hunk.range}
							aria-label={`${file.path} ${hunk.range}`}
							filename={hunk.range}
							additions={
								hunk.lines.filter((line) => line.kind === "added").length
							}
							deletions={
								hunk.lines.filter((line) => line.kind === "removed").length
							}
							lines={hunk.lines}
							className="max-w-none rounded-md [tab-size:2]"
						/>
					))
				)}
			</div>
		</details>
	);
}
