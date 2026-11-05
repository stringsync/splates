import { makeAssistantDataUI } from "@assistant-ui/react";
import type { Reminder } from "@splates/server/conversations";
import { BellIcon } from "lucide-react";
import { createContext, type JSX, useContext } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Board } from "./board";
import { CardSection } from "./card-section";
import { CardShell } from "./card-shell";
import { Markdown } from "./markdown";
import { ago } from "./plan-limits";
import { reminderId } from "./reminder-of";

/** Holds the conversation's reminders, so `ReminderUI` can draw each in the thread. */
export const Reminders = createContext<readonly Reminder[]>([]);

/** Renders a `data-reminder` part: the card left where the person came back. */
export const ReminderUI = makeAssistantDataUI<{ id: string }>({
	name: "reminder",
	render: ({ data }) => <ReminderLine id={data.id} />,
});

/** What the conversation's task is for: its one line, Before and After, and the way to the rest. */
export function ReminderCard({
	reminder,
}: {
	reminder: Reminder;
}): JSX.Element {
	const board = useContext(Board);
	const { task, line, before, after, since, at } = reminder;
	return (
		<CardShell
			label={`reminder of ${task}`}
			Icon={BellIcon}
			title={`Reminder · last here ${ago(Date.parse(since), Date.parse(at))}`}
			ringed={false}
			aside={
				<Button
					size="sm"
					variant="outline"
					disabled={!board.linked}
					onClick={() => board.openTask(task)}
				>
					Open task
				</Button>
			}
		>
			<div className="flex flex-col gap-3 px-3 py-3 text-sm">
				<p className="break-words font-medium">{line}</p>
				{(before !== "" || after !== "") && (
					<div className="grid min-w-0 gap-4 @md:grid-cols-2">
						{before !== "" && <Side name="Before" text={before} />}
						{after !== "" && <Side name="After" text={after} />}
					</div>
				)}
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

function Side({ name, text }: { name: string; text: string }): JSX.Element {
	return (
		<CardSection label={name} title={name}>
			<Markdown
				text={text}
				unlinked
				className="scroll-fade-y max-h-40 overflow-hidden leading-relaxed [--scroll-fade-b-size:3rem] [--scroll-fade-t-size:0px] [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
			/>
		</CardSection>
	);
}
