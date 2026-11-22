import { makeAssistantDataUI, useAuiState } from "@assistant-ui/react";
import type { Steps } from "@splates/server/plans/browser";
import { ListChecksIcon, PictureInPicture2Icon } from "lucide-react";
import { type JSX, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "#web/components/ui/button.tsx";
import { InMessage } from "./card-reply";
import { CardBody, CardShell } from "./card-shell";
import { canPopOut, usePopOut } from "./pop-out";
import {
	changedSteps,
	type Exchange,
	exchangesOf,
	versionsOf,
} from "./steps-asked";
import { StepsBody } from "./steps-body";
import { useStepsPlace } from "./steps-place";
import { Popped } from "./steps-popped";

/**
 * Renders a `data-steps` part: instructions the agent gives the person to
 * follow by hand. They keep their place in it, a step at a time, and can pop
 * it out into a window of its own to follow from another tab and ask the
 * agent about a step. A newer Steps card of the same title takes its place.
 */
export const StepsUI = makeAssistantDataUI<{ steps: Steps }>({
	name: "steps",
	render: ({ data }) => (
		<InMessage>
			<ThreadSteps steps={data.steps} />
		</InMessage>
	),
});

export function StepsCard({
	steps,
	versions = [steps],
	replaced = false,
	exchanges = [],
}: {
	steps: Steps;
	/** Every version of it in the thread, oldest first. */
	versions?: readonly Steps[];
	/** Whether a later message holds a newer version. */
	replaced?: boolean;
	/** The questions asked from its pop-out, and the agent's answers. */
	exchanges?: readonly Exchange[];
}): JSX.Element {
	// Undo shows the version before the newest, until the next one comes.
	const [undone, setUndone] = useState<Steps | null>(null);
	const newest = versions.at(-1) ?? steps;
	const before = versions.at(-2) ?? null;
	const back = undone === newest && before !== null;
	const shown = back ? (before as Steps) : newest;
	const changed = useMemo(
		() =>
			back ? new Map<number, string | null>() : changedSteps(before, newest),
		[back, before, newest],
	);
	const [done, place, move] = useStepsPlace(shown);
	const title = steps.title === "" ? "Steps" : `Steps: ${steps.title}`;
	const { popped, open, close } = usePopOut(title);
	const count = shown.steps.length;
	const window =
		popped === null
			? null
			: createPortal(
					<Popped
						steps={shown}
						done={done}
						place={place}
						move={move}
						changed={changed}
						exchanges={exchanges}
						update={
							before === null
								? null
								: {
										back,
										steps: [...changedSteps(before, newest).keys()],
										toggle: () => setUndone(back ? null : newest),
									}
						}
						window={popped}
					/>,
					popped.document.body,
				);
	const popButton = canPopOut() && (
		<Button
			variant="outline"
			size="xs"
			onClick={() => (popped === null ? void open() : close())}
		>
			<PictureInPicture2Icon />
			{popped === null ? "Pop out" : "Bring back"}
		</Button>
	);
	// An older version is a line in the thread; the newest card is the live one.
	if (replaced) {
		return (
			<CardShell
				label={`steps ${steps.title}`.trim()}
				Icon={ListChecksIcon}
				title={title}
				tone="steps"
				folded
				aside={
					<span className="flex items-center gap-2">
						<span className="text-muted-foreground text-xs">
							Replaced by a newer version
						</span>
						{popped !== null && popButton}
					</span>
				}
			>
				<CardBody
					text={steps.steps.map((step, i) => `${i + 1}. ${step}`).join("\n")}
					lead={false}
				/>
				{window}
			</CardShell>
		);
	}
	return (
		<CardShell
			label={`steps ${steps.title}`.trim()}
			Icon={ListChecksIcon}
			title={title}
			tone="steps"
			aside={
				<span className="flex items-center gap-2">
					<span className="text-muted-foreground text-xs tabular-nums">
						{done} of {count}
					</span>
					{popButton}
				</span>
			}
		>
			<StepsBody
				steps={shown}
				done={done}
				place={place}
				move={move}
				changed={changed}
				hint
			/>
			{window}
		</CardShell>
	);
}

/** A Steps card in its thread: its versions, and what was asked about it. */
function ThreadSteps({ steps }: { steps: Steps }): JSX.Element {
	const messages = useAuiState((state) => state.thread.messages);
	const index = useAuiState((state) => state.message.index);
	const running = useAuiState((state) => state.thread.isRunning);
	const thread = useMemo(() => {
		const versions = versionsOf(messages, steps.title);
		// Its last version is in a later message than this one.
		const newest = messages.findLastIndex(
			(message) => versionsOf([message], steps.title).length > 0,
		);
		return {
			versions: versions.length === 0 ? [steps] : versions,
			replaced: steps.title !== "" && newest > index,
			exchanges: exchangesOf(messages, steps.title, running),
		};
	}, [messages, index, running, steps]);
	return <StepsCard steps={steps} {...thread} />;
}
