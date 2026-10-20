import { BotMessageSquareIcon } from "lucide-react";
import { useContext } from "react";
import { Dispatching } from "./dispatching";
import type { Action } from "./task-actions";
import type { PlanParts } from "./task-plan-parts";

/**
 * Demo with an agent, for a task dialog's actions: starts a conversation
 * whose agent sets up and shows `task` with its change in, and opens it,
 * closing the dialog. Named for the agent, since it opens a conversation
 * rather than playing anything. None while its plan has no `## Demo`, or
 * the page holds no conversations.
 */
export function useDemo(task: string, plan: PlanParts | null): Action | null {
	const context = useContext(Dispatching);
	if (context === null || plan === null || plan.demo === "") {
		return null;
	}
	return {
		label: "Demo with an agent",
		Icon: BotMessageSquareIcon,
		closes: true,
		run: () => {
			void context.dispatch.demo(task, "after").then(context.open);
		},
	};
}
