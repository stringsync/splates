import { textOf } from "@stringsync/splates-server/conversations/browser";
import { GARDEN_TASK } from "@stringsync/splates-server/notes/browser";
import type { Needing } from "@stringsync/splates-server/plans";
import { directive, MERGE } from "@stringsync/splates-server/plans/browser";
import type { FileDiff } from "@stringsync/splates-server/tasks";
import { GitMergeIcon, SendHorizontalIcon, SproutIcon } from "lucide-react";
import { type JSX, useContext, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Textarea } from "#web/components/ui/textarea.tsx";
import { taskDiff } from "./api";
import { DiffFiles } from "./changes";
import { promptConversation } from "./conversation-api";
import type { ConversationFeed } from "./conversation-feed";
import { Dispatching } from "./dispatching";
import { Refusal, useRefusal } from "./refusal";

/**
 * The notes gardener's open draft, while its task is open: each note it
 * changes, adds or removes, old against new, and, once it asks for review,
 * Merge or Send back, as the review card's reply would, into its
 * conversation.
 */
export function GardenDraft({
	feed,
	onOpen,
}: {
	feed: ConversationFeed | null;
	onOpen: (id: string) => void;
}): JSX.Element | null {
	const dispatching = useContext(Dispatching);
	const task = dispatching?.dispatch.task(GARDEN_TASK) ?? null;
	const working = dispatching?.dispatch.on(GARDEN_TASK)[0] ?? null;
	const conversation = working?.conversation ?? null;
	const version =
		task === null ? null : `${task.ahead}:${task.added}:${task.removed}`;
	const [files, setFiles] = useState<FileDiff[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	// Here, not in the form, which goes once a reply is on its way.
	const { refusal, attempt } = useRefusal();
	useEffect(() => {
		if (version === null) {
			return;
		}
		let current = true;
		taskDiff(GARDEN_TASK).then(
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
	}, [version]);
	if (task === null) {
		return null;
	}
	return (
		<section
			aria-label="notes gardener's draft"
			className="flex max-w-3xl flex-col gap-3 rounded-lg border p-4 text-sm"
		>
			<header className="flex flex-wrap items-center gap-2">
				<SproutIcon className="size-4 text-success" />
				<h2 className="flex-1 font-medium">The notes gardener's draft</h2>
				{conversation !== null && (
					<Button
						variant="ghost"
						size="sm"
						onClick={() => onOpen(conversation.id)}
					>
						Open conversation
					</Button>
				)}
			</header>
			<p className="text-muted-foreground">{standing(working)}</p>
			<Refusal refusal={refusal} />
			{error !== null ? (
				<p className="text-destructive">{error}</p>
			) : files === null ? (
				<p className="text-muted-foreground">Reading the draft…</p>
			) : files.length === 0 ? (
				<p className="text-muted-foreground">No notes changed yet.</p>
			) : (
				<DiffFiles files={files} />
			)}
			{conversation !== null &&
				working !== null &&
				reviewing(working) &&
				feed !== null && (
					<Verdict
						key={conversation.id}
						conversation={conversation.id}
						feed={feed}
						attempt={attempt}
					/>
				)}
		</section>
	);
}

/** Whether `working` waits on the person's review of the draft. */
function reviewing(working: Needing): boolean {
	return working.need.kind === "waiting" && working.need.why === "review";
}

/** Where the draft stands, as its conversation says. */
function standing(working: Needing | null): string {
	if (working === null) {
		return "No agent is on it.";
	}
	const said = working.conversation?.messages?.findLast(
		(each) => each.role === "user",
	);
	if (
		working.need.kind !== "waiting" &&
		said !== undefined &&
		directive(textOf(said)) === MERGE
	) {
		return "Merge asked: the gardener lands it.";
	}
	if (working.need.kind === "waiting") {
		switch (working.need.why) {
			case "review":
				return "Ready for your review: merge it, or send it back with what to change.";
			case "questions":
			case "ask":
				return "The gardener has questions for you in its conversation.";
			default:
				return "The gardener stopped: open its conversation to see why.";
		}
	}
	return "The gardener is still drafting.";
}

/**
 * Merge, or what to change, sent into `conversation` as the review card's
 * reply would be: it shows as said at once, so the draft is no longer
 * waiting on review and this goes, or comes back with the server's refusal.
 */
function Verdict({
	conversation,
	feed,
	attempt,
}: {
	conversation: string;
	feed: ConversationFeed;
	attempt: (write: Promise<void>, failed: string) => Promise<boolean>;
}): JSX.Element {
	const [changes, setChanges] = useState("");
	const send = (text: string, failed: string) => {
		const sending = feed.send(conversation, text);
		void attempt(
			promptConversation(conversation, text, [], false, sending.id).then(
				(state) => feed.answered(conversation, sending, state),
				(error: unknown) => {
					feed.refused(conversation, sending, error);
					throw error;
				},
			),
			failed,
		);
	};
	return (
		<form
			className="flex flex-col gap-2 border-t pt-3"
			onSubmit={(event) => {
				event.preventDefault();
				if (changes.trim() !== "") {
					send(changes.trim(), "Not sent back");
				}
			}}
		>
			<Textarea
				aria-label="What to change in the gardener's draft"
				placeholder="Say what to change…"
				value={changes}
				onChange={(event) => setChanges(event.target.value)}
				className="min-h-9"
			/>
			<div className="flex flex-wrap items-center gap-2">
				<span className="flex-1" />
				<Button
					type="submit"
					variant="outline"
					disabled={changes.trim() === ""}
				>
					<SendHorizontalIcon data-icon="inline-start" />
					Send back
				</Button>
				<Button
					type="button"
					disabled={changes.trim() !== ""}
					onClick={() => send(MERGE, "Not merged")}
				>
					<GitMergeIcon data-icon="inline-start" />
					Merge
				</Button>
			</div>
		</form>
	);
}
