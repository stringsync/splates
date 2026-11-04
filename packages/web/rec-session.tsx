import type { RecMoment, RecSessionDetail } from "@splates/server/rec/browser";
import { REC_STORE_POLICY } from "@splates/server/rec/browser";
import {
	CopyIcon,
	FolderOpenIcon,
	PencilIcon,
	SendIcon,
	Trash2Icon,
} from "lucide-react";
import { type JSX, useEffect, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { Skeleton } from "#web/components/ui/skeleton.tsx";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#web/components/ui/tabs.tsx";
import {
	deleteRecSession,
	openRecFolder,
	recFileUrl,
	recLog,
	recSession,
	recVideoUrl,
	renameRecSession,
} from "./api";
import { bytesText, clock } from "./rec-format";

/** One saved session: its recording with moments marked, and what rec read from it. */
export function RecSession({
	name,
	sendToAgent,
	gone,
}: {
	name: string;
	/** Starts a conversation about the session; absent when none can start. */
	sendToAgent?: (name: string) => Promise<void>;
	/** Called once the session is deleted or renamed away. */
	gone: (renamedTo?: string) => void;
}): JSX.Element {
	const [session, setSession] = useState<RecSessionDetail | null>(null);
	const [failed, setFailed] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);
	const video = useRef<HTMLVideoElement>(null);
	const [renaming, setRenaming] = useState<string | null>(null);
	const [deleting, setDeleting] = useState(false);
	useEffect(() => {
		setSession(null);
		setFailed(false);
		recSession(name).then(setSession, () => setFailed(true));
	}, [name]);
	if (session === null) {
		return failed ? (
			<p className="text-muted-foreground text-sm">
				No session named {name}. It may have been deleted.
			</p>
		) : (
			<Skeleton className="h-40 w-full animate-pulse" />
		);
	}
	const seek = (moment: RecMoment) => {
		if (video.current !== null) {
			video.current.currentTime = Math.max(
				0,
				(moment.start - session.startedAt) / 1000,
			);
			void video.current.play().catch(() => {});
		}
	};
	const attempt = (work: () => Promise<void>) =>
		work().then(
			() => setProblem(null),
			(error: unknown) => setProblem((error as Error).message),
		);
	return (
		<section aria-label={name} className="flex min-w-0 flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<code className="font-medium text-sm">#{session.name}</code>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Copy reference"
					onClick={() => void navigator.clipboard.writeText(`#${session.name}`)}
				>
					<CopyIcon />
				</Button>
				<span className="text-muted-foreground text-xs">
					{new Date(session.startedAt).toLocaleString()} ·{" "}
					{clock(session.length)} · {bytesText(session.size)}
				</span>
			</div>
			<p className="text-muted-foreground text-xs">{REC_STORE_POLICY}</p>
			<div className="flex flex-wrap gap-2">
				<Button
					variant="outline"
					size="sm"
					onClick={() => setRenaming(session.name)}
				>
					<PencilIcon /> Rename
				</Button>
				{sendToAgent !== undefined && (
					<Button
						variant="outline"
						size="sm"
						onClick={() => void attempt(() => sendToAgent(session.name))}
					>
						<SendIcon /> Send to an agent
					</Button>
				)}
				<Button
					variant="outline"
					size="sm"
					onClick={() => void attempt(() => openRecFolder(session.name))}
				>
					<FolderOpenIcon /> Open folder
				</Button>
				<Button variant="outline" size="sm" onClick={() => setDeleting(true)}>
					<Trash2Icon /> Delete
				</Button>
			</div>
			{problem !== null && (
				<p role="alert" className="text-destructive text-sm">
					{problem}
				</p>
			)}
			{session.video ? (
				<div className="flex flex-col gap-1">
					{/* biome-ignore lint/a11y/useMediaCaption: a bug recording; its words are in Moments */}
					<video
						ref={video}
						controls
						preload="metadata"
						src={recVideoUrl(session.name)}
						className="max-h-[60vh] w-full rounded-lg border bg-black"
					/>
					<Ticks session={session} seek={seek} />
				</div>
			) : (
				<p className="text-muted-foreground text-sm">
					This session has no recording to play.
				</p>
			)}
			<Tabs defaultValue="moments">
				<TabsList>
					<TabsTrigger value="moments">Moments</TabsTrigger>
					<TabsTrigger value="timeline">Timeline</TabsTrigger>
					<TabsTrigger value="stills">Stills</TabsTrigger>
					<TabsTrigger value="logs">Logs</TabsTrigger>
				</TabsList>
				<TabsContent value="moments">
					<Moments session={session} seek={seek} />
				</TabsContent>
				<TabsContent value="timeline">
					{session.timeline === undefined ? (
						<p className="text-muted-foreground text-sm">No timeline.</p>
					) : (
						<pre className="overflow-auto whitespace-pre-wrap rounded-lg border bg-card p-3 text-xs">
							{session.timeline}
						</pre>
					)}
				</TabsContent>
				<TabsContent value="stills">
					{session.stills.length === 0 ? (
						<p className="text-muted-foreground text-sm">No stills.</p>
					) : (
						<ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
							{session.stills.map((file) => (
								<li key={file}>
									<a
										href={recFileUrl(session.name, "still", file)}
										target="_blank"
										rel="noreferrer"
									>
										<img
											alt={file}
											loading="lazy"
											src={recFileUrl(session.name, "still", file)}
											className="rounded border"
										/>
									</a>
								</li>
							))}
						</ul>
					)}
				</TabsContent>
				<TabsContent value="logs">
					<Logs name={session.name} files={session.logs} />
				</TabsContent>
			</Tabs>
			<Dialog
				open={renaming !== null}
				onOpenChange={(open) => !open && setRenaming(null)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Rename session</DialogTitle>
						<DialogDescription>
							Lowercase words separated by hyphens. Its folder stays.
						</DialogDescription>
					</DialogHeader>
					<Input
						aria-label="New name"
						value={renaming ?? ""}
						onChange={(event) => setRenaming(event.target.value)}
					/>
					<DialogFooter>
						<Button
							disabled={
								renaming === null ||
								renaming.trim() === "" ||
								renaming === session.name
							}
							onClick={() => {
								const to = (renaming ?? "").trim();
								setRenaming(null);
								void attempt(async () => {
									await renameRecSession(session.name, to);
									gone(to);
								});
							}}
						>
							Rename
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<Dialog open={deleting} onOpenChange={setDeleting}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete {session.name}?</DialogTitle>
						<DialogDescription>
							The recording and everything rec saved with it are deleted from
							this machine. This cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDeleting(false)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={() => {
								setDeleting(false);
								void attempt(async () => {
									await deleteRecSession(session.name);
									gone();
								});
							}}
						>
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}

const ERRORS = new Set([
	"console-error",
	"exception",
	"request-failed",
	"log-error",
	"page-error",
]);

/** Whether any signal of the moment is an error, which the scrubber paints red. */
function isErrorMoment(moment: RecMoment): boolean {
	return moment.signals.some((each) => ERRORS.has(each.signal));
}

/** The line of a signal the moment points at, when its facts hold one. */
function lineOf(moment: RecMoment): string | null {
	for (const signal of moment.signals) {
		const detail = signal.detail;
		const text = detail.line ?? detail.text ?? detail.request;
		if (typeof text === "string" && signal.source !== "events") {
			return text;
		}
	}
	return null;
}

/** A bar as long as the recording with a tick at each moment, red for errors. */
function Ticks({
	session,
	seek,
}: {
	session: RecSessionDetail;
	seek: (moment: RecMoment) => void;
}): JSX.Element {
	return (
		<fieldset
			aria-label="Moments"
			className="relative m-0 h-4 min-w-0 rounded border-0 bg-muted p-0"
		>
			{session.momentList.map((moment) => (
				<button
					key={moment.rank}
					type="button"
					aria-label={`Moment ${moment.rank} at ${clock((moment.start - session.startedAt) / 1000)}`}
					onClick={() => seek(moment)}
					style={{
						left: `${Math.min(100, Math.max(0, ((moment.start - session.startedAt) / 1000 / Math.max(session.length, 1)) * 100))}%`,
					}}
					className={`absolute top-0 h-full w-1.5 -translate-x-1/2 rounded-sm ${
						isErrorMoment(moment) ? "bg-red-600" : "bg-primary"
					}`}
				/>
			))}
		</fieldset>
	);
}

function Moments({
	session,
	seek,
}: {
	session: RecSessionDetail;
	seek: (moment: RecMoment) => void;
}): JSX.Element {
	if (session.momentList.length === 0) {
		return <p className="text-muted-foreground text-sm">No moments.</p>;
	}
	return (
		<ul className="flex flex-col divide-y rounded-lg border bg-card px-3">
			{[...session.momentList]
				.sort((left, right) => left.start - right.start)
				.map((moment) => {
					const line = lineOf(moment);
					return (
						<li key={moment.rank} className="py-2">
							<button
								type="button"
								onClick={() => seek(moment)}
								className="flex w-full min-w-0 flex-col gap-0.5 text-left text-sm"
							>
								<span className="flex items-center gap-2">
									<span className="font-mono tabular-nums">
										{clock((moment.start - session.startedAt) / 1000)}
									</span>
									<span className="truncate">
										{moment.said ?? moment.pointed ?? "No words"}
									</span>
									<span className="ml-auto shrink-0 text-muted-foreground text-xs">
										score {moment.score.toFixed(2)}
									</span>
								</span>
								{moment.signals.length > 0 && (
									<span
										className={`text-xs ${isErrorMoment(moment) ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}
									>
										{[
											...new Set(moment.signals.map((each) => each.signal)),
										].join(", ")}
									</span>
								)}
								{line !== null && (
									<span className="truncate font-mono text-muted-foreground text-xs">
										{line}
									</span>
								)}
							</button>
						</li>
					);
				})}
		</ul>
	);
}

function Logs({ name, files }: { name: string; files: string[] }): JSX.Element {
	const [file, setFile] = useState(files[0] ?? null);
	const [text, setText] = useState<string | null>(null);
	useEffect(() => {
		setText(null);
		if (file !== null) {
			recLog(name, file).then(setText, () =>
				setText("Could not read this log."),
			);
		}
	}, [name, file]);
	if (file === null) {
		return <p className="text-muted-foreground text-sm">No logs.</p>;
	}
	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap gap-2">
				{files.map((each) => (
					<button
						key={each}
						type="button"
						aria-pressed={each === file}
						onClick={() => setFile(each)}
						className={`rounded-full border px-3 py-1 text-sm ${each === file ? "border-primary bg-primary/10 text-primary" : "bg-card"}`}
					>
						{each}
					</button>
				))}
			</div>
			<pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border bg-card p-3 font-mono text-xs">
				{text ?? "Loading…"}
			</pre>
		</div>
	);
}
