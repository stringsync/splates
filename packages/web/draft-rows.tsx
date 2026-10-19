import type { ConversationState } from "@stringsync/splates-server/conversations";
import { XIcon } from "lucide-react";
import { type JSX, useSyncExternalStore } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { AgentIcon } from "./agent-icons";
import {
	agentFor,
	NEW,
	newAddress,
	startsOne,
	taskFor,
} from "./conversation-address";
import { type AgentChoice, agentName } from "./conversation-feed";
import { type Drafts, newDraft } from "./drafts";
import { shownProject } from "./project-places";

/** What a new conversation not started yet is called until its first message. */
export const UNSTARTED = "New conversation";

/** A new conversation not started yet, as a row lists it. */
export interface Unstarted {
	/** Its draft's key, as `newDraft` names it. */
	key: string;
	/** Its screen's place under `#conversations/`, as `new/codex`. */
	open: string;
	agent: string;
	/** The task whose tree it starts in; null for the main tree. */
	task: string | null;
	/** Whether its screen is the one shown. */
	current: boolean;
}

/**
 * The new conversations not started yet in the project shown, the main
 * tree's first: each whose draft holds words or files, and the one whose
 * screen `open` names, held or not, so opening one lists it at once. With
 * `home`, nothing open shows the main tree's screen too, as beside a
 * sidebar, which lists it only once it holds something.
 */
export function useUnstarted(
	drafts: Drafts,
	open: string | null,
	home: boolean,
	agents: AgentChoice[],
	conversations: ConversationState[],
): Unstarted[] {
	const project = shownProject();
	const shown =
		startsOne(open) || (home && open === null)
			? newDraft(project, taskFor(open))
			: null;
	// One string, so the list renders again only when its drafts change.
	const held = useSyncExternalStore(
		(changed) => {
			const unwritten = drafts.events.on("written", changed);
			const undiscarded = drafts.events.on("discarded", changed);
			return () => {
				unwritten();
				undiscarded();
			};
		},
		() => drafts.unstarted(project).join("\n"),
	);
	const keys = held === "" ? [] : held.split("\n");
	if (startsOne(open) && shown !== null && !keys.includes(shown)) {
		keys.push(shown);
	}
	const root = newDraft(project);
	return keys.map((key) => {
		const task = key === root ? null : key.slice(root.length + 1);
		const place =
			key === shown && startsOne(open) && open !== null
				? open
				: (drafts.placeOf(key) ??
					(task === null
						? NEW
						: newAddress(agentFor(NEW, agents, conversations), task)));
		return {
			key,
			open: place,
			agent: agentFor(place, agents, conversations),
			task,
			current: key === shown,
		};
	});
}

/**
 * A new conversation not started yet, in the sidebar: its agent's mark and
 * New conversation, muted as an unnamed one is, with its task, and an X that
 * throws its draft away.
 */
export function UnstartedRow({
	unstarted,
	agents,
	onOpen,
	onDiscard,
}: {
	unstarted: Unstarted;
	agents: AgentChoice[];
	onOpen: () => void;
	onDiscard: () => void;
}): JSX.Element {
	const { agent, task, current } = unstarted;
	return (
		<div
			className={cn(
				"group/item relative flex items-center rounded-md text-foreground hover:bg-foreground/[0.05]",
				current && "bg-accent hover:bg-accent",
			)}
		>
			<button
				type="button"
				data-row
				aria-current={current ? "page" : undefined}
				onClick={onOpen}
				className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-8 pl-3 text-left"
			>
				<AgentIcon
					agent={agent}
					name={agentName(agents, agent)}
					className="size-3.5 text-foreground/70"
				/>
				<span className="min-w-0 flex-1 truncate text-muted-foreground text-sm italic">
					{UNSTARTED}
				</span>
				{task !== null && (
					<span className="max-w-[40%] shrink-0 truncate text-muted-foreground text-xs">
						{task}
					</span>
				)}
			</button>
			<span className="absolute right-1 flex items-center opacity-0 group-focus-within/item:opacity-100 group-hover/item:opacity-100 pointer-coarse:opacity-100">
				<Button
					size="icon-xs"
					variant="ghost"
					aria-label="Discard draft"
					title="Discard draft"
					onClick={onDiscard}
				>
					<XIcon />
				</Button>
			</span>
		</div>
	);
}

/**
 * The new conversations not started yet, atop the phone's inbox, each a
 * finger's height as its rows are, to go back to; a tap opens its screen.
 */
export function UnstartedGroup({
	unstarted,
	agents,
	onOpen,
}: {
	unstarted: Unstarted[];
	agents: AgentChoice[];
	onOpen: (open: string) => void;
}): JSX.Element | null {
	if (unstarted.length === 0) {
		return null;
	}
	return (
		<section aria-label="Drafts" className="pt-4">
			<h2 className="px-4 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
				Drafts · {unstarted.length}
			</h2>
			<ul className="flex flex-col">
				{unstarted.map((each) => (
					<li key={each.key}>
						<button
							type="button"
							onClick={() => onOpen(each.open)}
							className="flex min-h-16 w-full select-none items-center gap-3 py-2.5 pr-4 pl-4 text-left active:bg-muted"
						>
							<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
								<AgentIcon
									agent={each.agent}
									name={agentName(agents, each.agent)}
									className="size-5 text-foreground/80"
								/>
							</span>
							<span className="min-w-0 flex-1 truncate font-medium text-[15px] text-muted-foreground italic">
								{UNSTARTED}
							</span>
							{each.task !== null && (
								<span className="max-w-[40%] shrink-0 truncate text-muted-foreground text-xs">
									{each.task}
								</span>
							)}
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}
