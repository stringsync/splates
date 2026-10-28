import type { Event } from "@stringsync/splates-server/records";
import { type JSX, type ReactNode, useContext, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { ReplyContext } from "./card-reply";
import { MergeCardContext } from "./merge-card";
import { Refusal, useRefusal } from "./refusal";
import { grantRetry, Untold } from "./retry-grant";
import { SplatesEvent, type SplatesEventView } from "./splates-event";

type MergeEvent = Extract<Event, { action: "merge" }>;

/**
 * A refused merge's "Merge failed" line, with Why, which opens what the
 * merge event kept of the refusal, so the person need not scroll back
 * through the agent's tool output: the reason in words, the files a conflict
 * was in, each failed test with what it said, whom the gate blamed, what git
 * or the gate printed, and the attempts left. An older event without some of
 * these shows what it has.
 *
 * Refused for a spent budget while the thread's task still has none left,
 * its action is Grant instead, which gives another round of attempts as
 * `splates retry` does and tells the agent to merge again.
 */
export function MergeFailedLine({
	view,
	event,
}: {
	view: SplatesEventView;
	event: MergeEvent;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const grant = useGrant(event);
	return (
		<>
			<SplatesEvent
				event={{
					...view,
					words: [grant === null ? "Merge failed" : "Merge blocked"],
					mobile: {
						...view.mobile,
						words: view.mobile?.words ?? view.words,
						act: grant?.mobileAct ?? {
							label: "Why",
							run: () => setOpen(true),
						},
					},
					act: grant?.act ?? {
						label: event.task ?? "Merge details",
						run: () => setOpen(true),
					},
				}}
			/>
			{grant !== null && <Refusal refusal={grant.refusal} />}
			<MergeWhy event={event} open={open} onOpenChange={setOpen} />
		</>
	);
}

/**
 * The Grant of a merge refused for a spent budget, while the thread's task
 * is that one with no attempts left, or once granted here; null otherwise.
 * It is busy until the grant lands, then says granted.
 */
function useGrant(event: MergeEvent): {
	act: { label: string; run: () => void; done: string | null; busy: boolean };
	mobileAct: {
		label: string;
		run: () => void;
		done: string | null;
		busy: boolean;
	};
	refusal: string | null;
} | null {
	const card = useContext(MergeCardContext);
	const reply = useContext(ReplyContext);
	const { refusal, attempt } = useRefusal();
	const [granted, setGranted] = useState(false);
	const [busy, setBusy] = useState(false);
	const task = card?.task ?? null;
	const spent =
		task !== null &&
		task.task === event.task &&
		task.status === "working" &&
		task.budgetSpent;
	if (event.reason !== "budget_exhausted" || task === null) {
		return null;
	}
	if (!spent && !granted) {
		return null;
	}
	const run = () => {
		setBusy(true);
		void attempt(
			grantRetry(task.task, reply?.send ?? null)
				.then(() => setGranted(true))
				.catch((error: unknown) => {
					if (error instanceof Untold) {
						setGranted(true);
					}
					throw error;
				})
				.finally(() => setBusy(false)),
			"Merge attempts",
		);
	};
	return {
		act: {
			label: "Grant attempts",
			run,
			done: granted ? "Granted" : null,
			busy,
		},
		mobileAct: {
			label:
				task.mergeAttempts >= task.mergeAttemptLimit
					? `Grant ${task.mergeAttemptLimit} more`
					: `Grant ${task.conflictAttemptLimit} more`,
			run,
			done: granted ? "Granted" : null,
			busy,
		},
		refusal,
	};
}

/** The dialog a refused merge's Why opens. */
export function MergeWhy({
	event,
	open,
	onOpenChange,
}: {
	event: MergeEvent;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}): JSX.Element {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Merge failed: {event.task ?? ""}</DialogTitle>
					<DialogDescription>{worded(event)}</DialogDescription>
				</DialogHeader>
				<Why event={event} />
			</DialogContent>
		</Dialog>
	);
}

/** Everything the event kept beyond its reason, each part only when it has it. */
function Why({ event }: { event: MergeEvent }): JSX.Element {
	const files = event.files ?? [];
	const tests = event.failedTests ?? [];
	const landed = event.landed;
	const blamed = event.failureAttribution;
	const output = event.output ?? "";
	return (
		<div className="flex min-w-0 flex-col gap-3 text-sm">
			{event.reason === "conflict" && files.length > 0 && (
				<Part title="Conflicted files">
					<ul className="font-mono text-xs">
						{files.map((file) => (
							<li key={file} className="break-all">
								{file}
							</li>
						))}
					</ul>
				</Part>
			)}
			{tests.length > 0 && (
				<Part title={`Failed tests (${tests.length})`}>
					<ul className="flex flex-col gap-2">
						{tests.map((test) => (
							<li key={test.name}>
								<p className="break-words font-medium">{test.name}</p>
								{test.message !== "" && <Printed text={test.message} />}
							</li>
						))}
					</ul>
				</Part>
			)}
			{landed !== undefined && (
				<Part title="Landed since your last base">
					<p>
						{landed.total} {landed.total === 1 ? "commit" : "commits"} landed on{" "}
						{event.base ?? "the base"} since your last base.
					</p>
					{landed.commits.length > 0 && (
						<>
							<p className="text-muted-foreground">
								{landed.filtered
									? "Commits touching the failing test files, what they import, or files you changed:"
									: "None touched the failing test files, what they import, or files you changed; all landed commits:"}
							</p>
							<ul className="flex flex-col gap-1">
								{landed.commits.map((commit) => (
									<li key={commit.commit} className="break-words">
										<code>{commit.commit}</code> {commit.task ?? "-"}{" "}
										{commit.subject}
									</li>
								))}
							</ul>
						</>
					)}
				</Part>
			)}
			{blamed !== undefined && (
				<Part title="Blamed on">
					<p>{BLAMED[blamed](event.base ?? "the base")}</p>
				</Part>
			)}
			{output !== "" && (
				<Part title="Output">
					<Printed text={output} />
				</Part>
			)}
			{event.reason === "conflict" && event.conflictsLeft !== undefined ? (
				<p className="text-muted-foreground">
					{conflictsLeft(event.conflictsLeft)}
				</p>
			) : (
				event.attemptsLeft !== undefined && (
					<p className="text-muted-foreground">
						{attemptsLeft(event.attemptsLeft)}
					</p>
				)
			)}
		</div>
	);
}

function Part({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<section aria-label={title} className="flex min-w-0 flex-col gap-1">
			<h3 className="font-medium text-muted-foreground text-xs">{title}</h3>
			{children}
		</section>
	);
}

/** Text a program printed, kept as it was laid out. */
function Printed({ text }: { text: string }): JSX.Element {
	return (
		<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 font-mono text-xs">
			{text}
		</pre>
	);
}

/** Whom the gate blamed a failure on, in words, given the base. */
const BLAMED: Record<
	NonNullable<MergeEvent["failureAttribution"]>,
	(base: string) => string
> = {
	task: (base) =>
		`The task: the failing tests pass on ${base} and fail with it, so an attempt was spent.`,
	trunk: (base) =>
		`${base}: the tests fail there without the task, so no attempt was spent.`,
	flake: () =>
		"A flaky test: it passed when run again, so no attempt was spent.",
	environment: () =>
		"The environment: the failure could not be pinned on the task, so no attempt was spent.",
};

/** The refusal in words, by its reason, or the reason itself for one unknown here. */
function worded(event: MergeEvent): string {
	const base = event.base ?? "the base";
	switch (event.reason) {
		case "conflict":
			return `Rebasing onto ${base} conflicted.`;
		case "tests_failed":
			return `The merge gate's tests failed after rebasing onto ${base}.`;
		case "merge_failed":
			return `Git could not rebase the task onto ${base} or land it there.`;
		case "dirty":
			return "The worktree had uncommitted changes.";
		case "blocked":
			return "It was not ready to land: open questions under Blocked, unchecked steps under Next, or something else to settle first. No attempt was spent.";
		case "budget_exhausted":
			return "The task had used all its merge attempts.";
		case "lease_held":
			return "Another agent holds the task.";
		case "lease_lost":
			return "Another agent took the task during the merge.";
		case "not_found":
			return "There was no such task.";
		case "usage":
			return "The command was given wrongly.";
		default:
			return `Refused: ${event.reason}.`;
	}
}

function attemptsLeft(left: number): string {
	const shown = Math.max(0, left);
	return shown === 1
		? "1 merge attempt left."
		: `${shown} merge attempts left.`;
}

function conflictsLeft(left: number): string {
	const shown = Math.max(0, left);
	return shown === 1
		? "1 conflicted rebase left."
		: `${shown} conflicted rebases left.`;
}
