import type { ConversationState } from "@stringsync/splates-server/conversations";
import { SquareTerminalIcon } from "lucide-react";
import { type JSX, useContext, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { removeTask } from "./api";
import { taskRemoved } from "./board-expectations";
import { archiveConversation } from "./conversation-api";
import { useNameOf } from "./conversation-names";
import { useConversationProject } from "./conversation-project";
import { Dispatching } from "./dispatching";
import { useExpect, useExpectSnapshot } from "./expecting";
import { useHeldConversations } from "./handed-out";
import type { Refuse } from "./refusal";
import { useRowRefusal } from "./row-refusal";
import { ShellRunning, ShowTerminal } from "./terminal";

/**
 * Offers Archive or Unarchive for a conversation in its owning project.
 * Render `confirm` beside the control calling `file`: it asks before stopping
 * running work or removing unmerged changes, and for another project's work.
 */
export function useArchive(
	conversation: ConversationState,
	refuse: Refuse,
): {
	/**
	 * Files it away, or asks first; `then` as it goes, which shows at once,
	 * and `failed` if the server refuses, when it comes back with why under
	 * its row.
	 */
	file: (then?: () => void, failed?: () => void) => void;
	/** Whether `file` would ask first, were it called now. */
	asks: () => boolean;
	confirm: JSX.Element;
} {
	const [asking, setAsking] = useState(false);
	// Held while `confirm` asks.
	const after = useRef<(() => void) | undefined>(undefined);
	const failure = useRef<(() => void) | undefined>(undefined);
	const shellRunning = useContext(ShellRunning);
	const showTerminal = useContext(ShowTerminal);
	const dispatching = useContext(Dispatching);
	const project = useConversationProject();
	const nameOf = useNameOf();
	const expect = useExpect();
	const expectSnapshot = useExpectSnapshot();
	const { id, archived } = conversation;
	const row = useRowRefusal(id);
	// One handed on to another agent is that agent's to remove.
	const taken =
		conversation.task === null
			? undefined
			: project === null
				? dispatching?.dispatch.task(conversation.task)
				: project.tasks.find((task) => task.task === conversation.task);
	const task = !archived && taken?.takenBy === id ? taken : null;
	// The agents it started go with it, any at work stopped.
	const local = useHeldConversations();
	const held = project?.conversations ?? local;
	const along = held.filter((each) => each.startedBy === id && !each.archived);
	// One it started is done once it stopped working and its task is gone,
	// merged or removed.
	const live = along.filter(
		(each) =>
			each.status === "starting" ||
			each.status === "running" ||
			(each.task !== null &&
				(project === null
					? dispatching === null ||
						dispatching.dispatch.task(each.task) !== undefined
					: project.tasks.some((task) => task.task === each.task))),
	);
	const put = () => {
		let refused = archived ? "Not unarchived" : "Not archived";
		// The task goes first, so a failed archive leaves only that to try again.
		const removed =
			task === null
				? Promise.resolve()
				: removeTask(task.task, project?.project).catch((error: unknown) => {
						refused = "Not removed";
						throw error;
					});
		// Gone from the board at once too, or the task, still live while its
		// worktree goes, shows as an abandoned external agent in its place.
		if (task !== null && project === null) {
			void expectSnapshot(taskRemoved(task.task), removed).catch(() => {});
		}
		const write = removed.then(() =>
			archiveConversation(id, !archived, project?.project),
		);
		// What the server files along with it, as it goes or comes back.
		const others = archived
			? held.filter((each) => each.archived && each.archivedWith === id)
			: along;
		for (const each of others) {
			void expect(each.id, { archived: !archived }, write).catch(() => {});
		}
		void expect(id, { archived: !archived }, write).catch((error: unknown) => {
			failure.current?.();
			refuse(refused, error);
			row.refuse(refused, error);
		});
		after.current?.();
	};
	const working =
		conversation.status === "starting" || conversation.status === "running";
	// Otherwise only its shell can lose anything, like a dev server it runs;
	// asked as it is clicked, since the shell comes and goes without a render here.
	const asks = () =>
		!archived &&
		(project !== null ||
			task?.unmerged === true ||
			working ||
			live.length > 0 ||
			shellRunning(id));
	const file = (then?: () => void, failed?: () => void) => {
		after.current = then;
		failure.current = failed;
		if (asks()) {
			setAsking(true);
		} else {
			put();
		}
	};
	// Read while it asks, which renders it.
	const shell = asking && project === null && shellRunning(id);
	const confirm = (
		<Dialog open={asking} onOpenChange={setAsking}>
			<DialogContent showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>Archive {nameOf(conversation)}?</DialogTitle>
					{task !== null && (
						<DialogDescription>
							{!task.unmerged
								? `Archiving removes its task, ${task.task}, which has nothing unmerged.`
								: task.ahead !== null && task.ahead > 0
									? `${task.task} has unmerged changes. Archiving removes it, discarding its ${task.ahead} commit${task.ahead === 1 ? "" : "s"} not on ${task.base} and any uncommitted changes.`
									: task.ahead === 0
										? `${task.task} has uncommitted changes. Archiving removes it, discarding them.`
										: `${task.task} may have unmerged changes. Archiving removes it, discarding its worktree, branch and any uncommitted changes.`}
						</DialogDescription>
					)}
					{(working || live.length > 0 || shell || project !== null) && (
						<DialogDescription>
							{project !== null && !working && live.length === 0
								? "Archiving stops its agent and closes its terminal."
								: working
									? "The agent is still running. Archiving stops it and closes its terminal."
									: live.length > 0
										? "Archiving stops its agent."
										: conversation.status === "idle"
											? "Its terminal is still open. Archiving closes it, and stops the idle agent."
											: "Its terminal is still open. Archiving closes it."}
						</DialogDescription>
					)}
					{along.length > 0 && (
						<DialogDescription>
							It takes the agents it handed tasks to or started with it,
							stopping any at work, and unarchiving it brings them back:{" "}
							{along
								.map(
									(each) =>
										`${nameOf(each)}${each.status === "starting" ? " (waiting for agent to start)" : each.status === "running" ? " (working)" : ""}`,
								)
								.join(", ")}
							.
						</DialogDescription>
					)}
				</DialogHeader>
				<DialogFooter>
					{/* Only its shell stands in the way: show it, to stop what runs
					    there or see that nothing does. */}
					{!working && live.length === 0 && shell && showTerminal !== null && (
						<Button
							variant="outline"
							className="sm:mr-auto"
							onClick={() => {
								setAsking(false);
								showTerminal(id);
							}}
						>
							<SquareTerminalIcon />
							Show the terminal
						</Button>
					)}
					<DialogClose render={<Button variant="outline" />}>
						Cancel
					</DialogClose>
					<Button
						variant="destructive"
						onClick={() => {
							setAsking(false);
							put();
						}}
					>
						Archive
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
	return { file, asks, confirm };
}
