import { age } from "@stringsync/splates-server/age";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import type {
	HeldListing,
	QueueListing,
} from "@stringsync/splates-server/workers";
import { type JSX, useContext } from "react";
import { DropdownMenuItem } from "#web/components/ui/dropdown-menu.tsx";
import { moveQueued } from "./api";
import {
	archiveConversation,
	cancelConversation,
	restartConversation,
} from "./conversation-api";
import { useNameOf } from "./conversation-names";
import { Dispatching } from "./dispatching";
import { useEverywhere } from "./everywhere-context";
import type { InProject } from "./everywhere-feed";
import { NavigationContext } from "./navigation";
import { QueueEmpty, QueueRow, QueueSection, SortableRows } from "./queue-rows";
import { Refusal, useRefusal } from "./refusal";

/** What the Queue page knows of the conversations of every project. */
interface Known {
	/** Conversation `id` as the every-project feed has it, or undefined. */
	of: (id: string) => InProject<ConversationState> | undefined;
	/** Project `root`'s slug and name, or undefined for one not listed. */
	project: (root: string) => { slug: string; name: string } | undefined;
	/** Whether project `root` is the one this page shows. */
	here: (root: string) => boolean;
	/** Opens conversation `id` of project `root`, on its own project's page for another. */
	open: (root: string, id: string) => void;
}

/** What the Queue page's rows read of the conversations they name. */
export function useKnown(here: string): Known {
	const { conversations, projects } = useEverywhere(
		({ conversations, projects }) => ({ conversations, projects }),
	);
	const dispatching = useContext(Dispatching);
	const navigation = useContext(NavigationContext);
	const byId = new Map(conversations.map((each) => [each.id, each]));
	const byRoot = new Map(
		projects.map((each) => [
			each.root,
			{ slug: each.project, name: each.repo },
		]),
	);
	return {
		of: (id) => byId.get(id),
		project: (root) => byRoot.get(root),
		here: (root) => root === here,
		open: (root, id) => {
			const slug = byRoot.get(root)?.slug;
			if (root === here || slug === undefined) {
				dispatching?.open(id);
				return;
			}
			const url = new URL(location.href);
			url.searchParams.set("project", slug);
			url.hash = `#conversations/${id}`;
			navigation.show(url.toString());
		},
	};
}

/**
 * Who started a conversation splates started on its own: the groomer, an
 * automation or a hook; nothing for one the page does not hold.
 */
function startedBy(
	conversation: ConversationState | undefined,
): string | undefined {
	if (conversation === undefined) {
		return undefined;
	}
	if (conversation.persistent !== undefined) {
		return conversation.persistent;
	}
	return conversation.automation !== undefined ? "automation" : "hook";
}

/**
 * The agents running that splates started on its own: those automations,
 * hooks and the groomer started, in any project, each opened on its
 * conversation and stopped from its row.
 */
export function Running({
	held,
	known,
}: {
	held: HeldListing[];
	known: Known;
}): JSX.Element {
	const nameOf = useNameOf();
	const { refusal, refuse } = useRefusal();
	const capped = held.filter((each) => each.capped);
	const attempt = (title: string, write: Promise<void>) =>
		void write.catch((error: unknown) => refuse(title, error));
	return (
		<QueueSection title="Started by splates" count={capped.length}>
			<Refusal refusal={refusal} />
			{capped.length === 0 ? (
				<QueueEmpty>Nothing splates started runs</QueueEmpty>
			) : (
				capped.map((slot) => {
					const conversation = known.of(slot.id);
					const here = known.here(slot.project);
					const project = here
						? undefined
						: (known.project(slot.project)?.slug ?? slot.project);
					return (
						<QueueRow
							key={slot.id}
							name={
								slot.task ??
								(conversation ? nameOf(conversation) : "A conversation")
							}
							by={startedBy(conversation)}
							age={age(slot.since)}
							id={here ? undefined : known.project(slot.project)?.name}
							quiet={{
								label: "Stop",
								onClick: () =>
									attempt("Not stopped", cancelConversation(slot.id, project)),
							}}
							main={{
								label: "Open",
								onClick: () => known.open(slot.project, slot.id),
							}}
							menu={
								<>
									<DropdownMenuItem
										onClick={() =>
											attempt(
												"Not restarted",
												restartConversation(slot.id, project),
											)
										}
									>
										Restart
									</DropdownMenuItem>
									<DropdownMenuItem
										onClick={() =>
											attempt(
												"Not archived",
												archiveConversation(slot.id, true, project),
											)
										}
									>
										Archive
									</DropdownMenuItem>
								</>
							}
						/>
					);
				})
			)}
		</QueueSection>
	);
}

/**
 * The agents waiting to start, as while paused, first in line first,
 * dragged into another order; each opened, sent to the front, or put away.
 */
export function Waiting({
	queue,
	known,
}: {
	queue: QueueListing[];
	known: Known;
}): JSX.Element {
	const nameOf = useNameOf();
	const { refusal, refuse } = useRefusal();
	const move = (id: string, to: number) =>
		void moveQueued(id, to + 1).catch((error: unknown) =>
			refuse("Not moved", error),
		);
	return (
		<QueueSection title="Waiting to start" count={queue.length}>
			<Refusal refusal={refusal} />
			{queue.length === 0 ? (
				<QueueEmpty>Nothing waits</QueueEmpty>
			) : (
				<SortableRows
					items={queue}
					idOf={(entry) => entry.id}
					label="waiting to start"
					onMove={move}
					row={(entry, { grip, dragging }) => {
						const conversation = known.of(entry.id);
						const here = known.here(entry.project);
						const project = here
							? undefined
							: (known.project(entry.project)?.slug ?? entry.project);
						return (
							<QueueRow
								grip={grip}
								dragging={dragging}
								name={
									entry.task ??
									(conversation ? nameOf(conversation) : "A conversation")
								}
								by={
									entry.reason === "paused" ? "paused" : startedBy(conversation)
								}
								age={age(entry.since)}
								id={here ? undefined : known.project(entry.project)?.name}
								main={{
									label: "Open",
									onClick: () => known.open(entry.project, entry.id),
								}}
								menu={
									<>
										<DropdownMenuItem
											disabled={entry.position === 1}
											onClick={() => move(entry.id, 0)}
										>
											Move to front
										</DropdownMenuItem>
										<DropdownMenuItem
											onClick={() =>
												void archiveConversation(entry.id, true, project).catch(
													(error: unknown) => refuse("Not cancelled", error),
												)
											}
										>
											Cancel
										</DropdownMenuItem>
									</>
								}
							/>
						);
					}}
				/>
			)}
		</QueueSection>
	);
}
