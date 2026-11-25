import type { TaskRecord } from "@splates/server/board";
import { BotIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import { agentQueuedBy } from "./agent-queued-mark";
import { Board } from "./board";

/** The "Queued by <task>" banner on the page of an agent-queued task. */
export function AgentQueuedBanner({
	todo,
}: {
	todo: TaskRecord;
}): JSX.Element | null {
	const board = useContext(Board);
	const by = agentQueuedBy(todo);
	if (by === null) {
		return null;
	}
	const name =
		by.task ?? (by.fromTask === undefined ? "an agent" : `#${by.fromTask}`);
	return (
		<section
			role="status"
			aria-label="Queued by an agent"
			className="mb-3 flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm"
		>
			<BotIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
			<div className="flex flex-col gap-0.5">
				<p>
					Queued by{" "}
					{by.task !== null && board.tasks.includes(by.task) ? (
						<button
							type="button"
							className="underline"
							onClick={() => board.openTask(by.task as string)}
						>
							{name}
						</button>
					) : (
						name
					)}
				</p>
			</div>
		</section>
	);
}
