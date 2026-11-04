import { age } from "@splates/server/age";
import type { ConversationState } from "@splates/server/conversations";
import type { HeldListing, QueueListing } from "@splates/server/workers";
import { type JSX, useContext } from "react";
import { DropdownMenuItem } from "#web/components/ui/dropdown-menu.tsx";
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
import { usePendingWrites } from "./pending";
import { QueueRow, QueueSection } from "./queue-rows";
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
 * Lists the agents running that splates started on its own (automations,
 * hooks and the groomer, in any project); open or stop each from its card.
 */
export function Running({
	held,
	known,
}: {
	held: HeldListing[];
	known: Known;
}): JSX.Element | null {
	const nameOf = useNameOf();
	const { refusal, refuse } = useRefusal();
	const automatic = held.filter((each) => each.automatic);
	const writes = usePendingWrites();
	const attempt = (id: string, title: string, write: () => Promise<void>) =>
		void writes.run(id, write).catch((error: unknown) => refuse(title, error));
	return (
		<>
			<Refusal refusal={refusal} />
			{automatic.map((held) => {
				const conversation = known.of(held.id);
				const here = known.here(held.project);
				const project = here
					? undefined
					: (known.project(held.project)?.slug ?? held.project);
				return (
					<QueueRow
						key={held.id}
						pending={writes.pending(held.id)}
						name={
							held.task ??
							(conversation ? nameOf(conversation) : "A conversation")
						}
						by={startedBy(conversation)}
						age={age(held.since)}
						id={here ? undefined : known.project(held.project)?.name}
						quiet={{
							label: "Stop",
							onClick: () =>
								attempt(held.id, "Not stopped", () =>
									cancelConversation(held.id, project),
								),
						}}
						main={{
							label: "Open",
							onClick: () => known.open(held.project, held.id),
						}}
						menu={
							<>
								<DropdownMenuItem
									onClick={() =>
										attempt(held.id, "Not restarted", () =>
											restartConversation(held.id, project),
										)
									}
								>
									Restart
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={() =>
										attempt(held.id, "Not archived", () =>
											archiveConversation(held.id, true, project),
										)
									}
								>
									Archive
								</DropdownMenuItem>
							</>
						}
					/>
				);
			})}
		</>
	);
}

/**
 * Lists the agents waiting to start, first in line first, each to open or
 * cancel. Pass `queue` as read, and `known` to name each one's conversation.
 */
export function Waiting({
	queue,
	known,
}: {
	queue: QueueListing[];
	known: Known;
}): JSX.Element | null {
	const nameOf = useNameOf();
	const { refusal, refuse } = useRefusal();
	const writes = usePendingWrites();
	if (queue.length === 0 && refusal === null) {
		return null;
	}
	return (
		<QueueSection title="Waiting to start" count={queue.length}>
			<Refusal refusal={refusal} />
			<ol aria-label="waiting to start" className="flex flex-col gap-1.5">
				{queue.map((entry) => {
					const conversation = known.of(entry.id);
					const here = known.here(entry.project);
					const project = here
						? undefined
						: (known.project(entry.project)?.slug ?? entry.project);
					return (
						<li key={entry.id}>
							<QueueRow
								pending={writes.pending(entry.id)}
								name={
									entry.task ??
									(conversation ? nameOf(conversation) : "A conversation")
								}
								by={
									entry.reason === "paused" || entry.reason === "machine busy"
										? entry.reason
										: startedBy(conversation)
								}
								age={age(entry.since)}
								id={here ? undefined : known.project(entry.project)?.name}
								main={{
									label: "Open",
									onClick: () => known.open(entry.project, entry.id),
								}}
								menu={
									<DropdownMenuItem
										onClick={() =>
											void writes
												.run(entry.id, () =>
													archiveConversation(entry.id, true, project),
												)
												.catch((error: unknown) =>
													refuse("Not cancelled", error),
												)
										}
									>
										Cancel
									</DropdownMenuItem>
								}
							/>
						</li>
					);
				})}
			</ol>
		</QueueSection>
	);
}
