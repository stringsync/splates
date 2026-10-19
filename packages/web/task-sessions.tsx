import { age } from "@stringsync/splates-server/age";
import type {
	ConversationState,
	Session,
} from "@stringsync/splates-server/conversations";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { AgentIcon } from "./agent-icons";
import { bringSession, listSessions } from "./conversation-api";
import { type AgentChoice, agentName } from "./conversation-feed";
import { Refusal, useRefusal } from "./refusal";

/**
 * The sessions the agents hold in the task's tree that the page does not,
 * such as one started in the Claude or Codex CLI, each brought in as a
 * conversation on a click.
 */
export function Sessions({
	task,
	agents,
	onBrought,
}: {
	task: string;
	agents: AgentChoice[];
	onBrought: (conversation: ConversationState) => void;
}): JSX.Element {
	// Null while the agents are asked, which starts each of them.
	const [sessions, setSessions] = useState<Session[] | null>(null);
	const [bringing, setBringing] = useState<string | null>(null);
	const { refusal, refuse } = useRefusal();
	useEffect(() => {
		let current = true;
		setSessions(null);
		listSessions(task).then(
			(listed) => current && setSessions(listed),
			(error: unknown) => {
				if (current) {
					setSessions([]);
					refuse("Sessions not listed", error);
				}
			},
		);
		return () => {
			current = false;
		};
	}, [task, refuse]);
	const bring = (session: Session) => {
		setBringing(session.session);
		bringSession(session, task).then(onBrought, (error: unknown) => {
			setBringing(null);
			refuse("Not brought in", error);
		});
	};
	return (
		<section aria-label="sessions" className="flex flex-col gap-1">
			<h3 className="font-medium text-muted-foreground text-xs">
				Sessions in this worktree
			</h3>
			{sessions === null ? (
				<p className="text-muted-foreground text-xs">Asking the agents…</p>
			) : sessions.length === 0 ? (
				<p className="text-muted-foreground text-xs">
					None the page could bring in.
				</p>
			) : (
				<>
					<p className="text-muted-foreground text-xs">
						Close one in its CLI before bringing it in, so the two do not write
						to it at once.
					</p>
					<ul className="flex flex-col">
						{sessions.map((each) => (
							<li
								key={`${each.agent} ${each.session}`}
								className="flex min-w-0 items-center gap-2 py-1"
							>
								<AgentIcon
									agent={each.agent}
									name={agentName(agents, each.agent)}
									className="size-3.5 text-foreground/70"
								/>
								<span
									className={
										each.title === null
											? "min-w-0 flex-1 truncate text-muted-foreground italic"
											: "min-w-0 flex-1 truncate"
									}
								>
									{each.title ?? "Untitled session"}
								</span>
								{each.updatedAt !== null && (
									<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
										{age(each.updatedAt)} ago
									</span>
								)}
								<Button
									size="xs"
									variant="outline"
									disabled={bringing !== null}
									onClick={() => bring(each)}
								>
									{bringing === each.session ? "Bringing in…" : "Bring in"}
								</Button>
							</li>
						))}
					</ul>
				</>
			)}
			<Refusal refusal={refusal} />
		</section>
	);
}
