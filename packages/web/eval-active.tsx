import type { ConversationState } from "@splates/server/conversations";
import type { JSX } from "react";
import { reportedAs, useNameOf } from "./conversation-names";
import { loopLabel, loopTarget } from "./eval-loops";

/** Every unarchived eval conversation, kept individually until archived. */
export function EvalActive({
	conversations,
	onOpen,
}: {
	conversations: ConversationState[];
	onOpen: (id: string) => void;
}): JSX.Element {
	const nameOf = useNameOf();
	return (
		<section
			aria-label="Active eval conversations"
			className="flex flex-col gap-3"
		>
			<div>
				<h2 className="font-medium text-lg">Active evals</h2>
				<p className="text-muted-foreground text-xs">
					Eval conversations stay here until archived. You can plan more runs
					while these continue.
				</p>
			</div>
			{conversations.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No unarchived eval conversations.
				</p>
			) : (
				<ul className="flex flex-col overflow-hidden rounded-lg border bg-card">
					{conversations.map((conversation) => {
						const target = loopTarget(conversation, true);
						const ending = reportedAs(conversation);
						return (
							<li key={conversation.id} className="border-b last:border-b-0">
								<button
									type="button"
									onClick={() => onOpen(conversation.id)}
									className="flex w-full min-w-0 flex-col gap-1 px-4 py-3.5 text-left hover:bg-accent/50"
								>
									<span className="font-medium text-sm break-words">
										{nameOf(conversation)}
									</span>
									{target !== null && (
										<span className="text-muted-foreground text-xs break-words">
											{"scenario" in target ? target.scenario : target.run}
										</span>
									)}
									<span className="text-muted-foreground text-xs">
										{conversation.evaluating
											? "Running evals"
											: ending === "done" || ending === "merged"
												? "Completed"
												: ending === "removed" || ending === "deferred"
													? "Stopped"
													: loopLabel(conversation)}
									</span>
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}
