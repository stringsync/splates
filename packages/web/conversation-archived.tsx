import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { Details } from "@stringsync/splates-server/tasks";
import { ChevronLeftIcon } from "lucide-react";
import {
	type JSX,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Duration } from "webappwiz/time";
import { Button } from "#web/components/ui/button.tsx";
import { type AgentChoice, agentName } from "./conversation-feed";
import { conversationIndex } from "./conversation-index";
import { Item } from "./conversation-item";
import { needOf } from "./conversation-rows";
import { useEverywhere } from "./everywhere-context";
import { useNow } from "./hooks/use-now";
import { NavigationContext } from "./navigation";
import { newConversationUrl } from "./new-conversation-project";
import { ago } from "./plan-limits";
import { BarButton, TopBar } from "./top-bar";

/** How many archived conversations the page draws at a time. */
export const ARCHIVED_PAGE = 50;

/**
 * The Archived page: every archived conversation across projects, newest
 * first, to open one or bring it back.
 */
export function Archived({
	tasks,
	conversations,
	here,
	agents,
	onOpen,
	onBack,
}: {
	tasks: Details[];
	conversations: ConversationState[];
	here: { root: string; repo: string };
	agents: AgentChoice[];
	onOpen: (id: string) => void;
	onBack: (() => void) | null;
}): JSX.Element {
	// Each row says how long ago it was archived, its project and latest
	// message. Every one splates keeps is listed, since it deletes the older.
	const now = useNow(true, Duration.mins(1));
	const navigation = useContext(NavigationContext);
	const everywhere = useEverywhere((feed) => ({
		available: feed.available,
		projects: feed.projects,
		conversations: conversationIndex(feed),
	}));
	// One list across projects, the page's own from the live feed, which shows
	// an archive at once, and the rest from the feed of every project.
	const entries = useMemo(() => {
		const own = conversations.map((conversation) => ({
			conversation,
			project: null as string | null,
			name: here.repo,
		}));
		if (!everywhere.available) {
			return own.toSorted((one, other) =>
				byArchivedAt(one.conversation, other.conversation),
			);
		}
		const elsewhere = everywhere.projects
			.filter((each) => each.root !== here.root)
			.flatMap((each) =>
				everywhere.conversations
					.filter((state) => state.project === each.project && state.archived)
					.map((conversation) => ({
						conversation,
						project: each.project as string | null,
						name: each.repo,
					})),
			);
		return [...own, ...elsewhere].toSorted((one, other) =>
			byArchivedAt(one.conversation, other.conversation),
		);
	}, [conversations, here, everywhere]);
	// Drawn a page at a time, since every row is a whole conversation's item.
	const [pages, setPages] = useState(1);
	const shown = entries.slice(0, pages * ARCHIVED_PAGE);
	const more = useNearEnd(shown.length, shown.length < entries.length, () =>
		setPages((pages) => pages + 1),
	);
	return (
		<section
			aria-label="archived conversations"
			className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col gap-2"
		>
			<TopBar
				leading={
					onBack !== null && (
						<BarButton label="Back to conversations" onClick={onBack}>
							<ChevronLeftIcon />
						</BarButton>
					)
				}
				title="Archived"
			/>
			{entries.length === 0 ? (
				<p className="text-muted-foreground text-sm">Nothing archived.</p>
			) : (
				<div className="min-h-0 overflow-y-auto overscroll-contain">
					<ul className="flex flex-col gap-1">
						{shown.map(({ conversation, project, name }) => (
							<li key={conversation.id}>
								<Item
									conversation={conversation}
									agent={agentName(agents, conversation.agent)}
									need={needOf(project === null ? tasks : [], conversation)}
									current={false}
									onOpen={() =>
										project === null
											? onOpen(conversation.id)
											: navigation.show(
													newConversationUrl(project, conversation.id),
												)
									}
									project={name}
									preview={latestText(conversation)}
									ago={
										conversation.archivedAt === null
											? null
											: ago(Date.parse(conversation.archivedAt), now)
									}
								/>
							</li>
						))}
					</ul>
					{shown.length < entries.length && (
						<Button
							ref={more}
							variant="ghost"
							size="sm"
							className="my-2 w-full text-muted-foreground"
							onClick={() => setPages((pages) => pages + 1)}
						>
							Show more
						</Button>
					)}
				</div>
			)}
		</section>
	);
}

/**
 * A ref for the element at the end of a list of `drawn` rows, calling
 * `onNear` when it comes into sight while `pending`, for the next page to
 * draw itself: watched again as each page lands, so a tall window fills.
 */
function useNearEnd(
	_drawn: number,
	pending: boolean,
	onNear: () => void,
): (element: HTMLElement | null) => void {
	const [end, setEnd] = useState<HTMLElement | null>(null);
	const near = useRef(onNear);
	near.current = onNear;
	useEffect(() => {
		if (
			end === null ||
			!pending ||
			typeof IntersectionObserver === "undefined"
		) {
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((each) => each.isIntersecting)) {
					near.current();
				}
			},
			{ rootMargin: "200px" },
		);
		observer.observe(end);
		return () => observer.disconnect();
	}, [end, pending]);
	return setEnd;
}

/** The latest thing said, on one line, leaving out tool calls and thoughts. */
function latestText(conversation: ConversationState): string | null {
	for (const message of conversation.messages.toReversed()) {
		const text = message.parts
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join(" ")
			.replace(/\s+/g, " ")
			.trim();
		if (text !== "") {
			return text;
		}
	}
	return null;
}

/** Archived last first, by when it started for a log too old to say. */
function byArchivedAt(
	one: ConversationState,
	other: ConversationState,
): number {
	return (other.archivedAt ?? other.createdAt).localeCompare(
		one.archivedAt ?? one.createdAt,
	);
}
