import { makeAssistantDataUI } from "@assistant-ui/react";
import type { Reminder } from "@splates/server/conversations";
import { BellIcon } from "lucide-react";
import { createContext, type JSX, useContext, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Board } from "./board";
import { CardShell } from "./card-shell";
import { ago } from "./plan-limits";
import { reminderId } from "./reminder-of";

/** Holds the conversation's reminders, so `ReminderUI` can draw each in the thread. */
export const Reminders = createContext<readonly Reminder[]>([]);

/** Renders a `data-reminder` part: the card left where the person came back. */
export const ReminderUI = makeAssistantDataUI<{ id: string }>({
	name: "reminder",
	render: ({ data }) => <ReminderLine id={data.id} />,
});

/** What the conversation's task is for: its one line and the way to the rest. */
export function ReminderCard({
	reminder,
}: {
	reminder: Reminder;
}): JSX.Element | null {
	const board = useContext(Board);
	const [dismissed, setDismissed] = useState(false);
	const { task, line, since, at } = reminder;
	if (dismissed) {
		return null;
	}
	return (
		<CardShell
			label={`reminder of ${task}`}
			Icon={BellIcon}
			title={`Reminder · last here ${ago(Date.parse(since), Date.parse(at))}`}
			ringed={false}
			aside={
				<span className="flex items-center gap-2">
					<Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
						Dismiss
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={!board.linked}
						onClick={() => board.openTask(task)}
					>
						Open task
					</Button>
				</span>
			}
		>
			<div className="flex flex-col gap-3 px-3 py-3 text-sm">
				<p className="break-words font-medium">{line}</p>
			</div>
		</CardShell>
	);
}

function ReminderLine({ id }: { id: string }): JSX.Element | null {
	const reminder = useContext(Reminders).find(
		(each) => reminderId(each.at) === id,
	);
	if (reminder === undefined) {
		return null;
	}
	return <ReminderCard reminder={reminder} />;
}
