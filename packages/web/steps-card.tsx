import { makeAssistantDataUI, useAuiState } from "@assistant-ui/react";
import type { Steps } from "@splates/server/plans/browser";
import { ListChecksIcon, PictureInPicture2Icon } from "lucide-react";
import { type JSX, use, useMemo } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { InMessage } from "./card-reply";
import { CardBody, CardShell } from "./card-shell";
import { EvalsConversation } from "./evals-card";
import { canPopOut } from "./pop-out";
import {
	changedSteps,
	type Finished,
	finishedOf,
	versionsOf,
} from "./steps-asked";
import { StepsBody } from "./steps-body";
import { DoneBar } from "./steps-done";
import { useStepsPlace } from "./steps-place";
import { isShown, useStepsPopOut } from "./steps-pop-host";
import { InPopout } from "./steps-popped";
import { useStepPreview } from "./steps-preview";

/**
 * Renders a `data-steps` part: instructions the agent gives the person to
 * follow by hand. They keep their place in it, a step at a time, and can pop
 * it out into a window of its own to follow from another tab and ask the
 * agent about a step. A newer Steps card of the same title takes its place.
 */
export const StepsUI = makeAssistantDataUI<{ steps: Steps }>({
	name: "steps",
	render: ({ data }) => <StepsPart steps={data.steps} />,
});

export function StepsCard({
	steps,
	versions = [steps],
	replaced = false,
	finished = null,
}: {
	steps: Steps;
	/** Every version of it in the thread, oldest first. */
	versions?: readonly Steps[];
	/** Whether a later message holds a newer version. */
	replaced?: boolean;
	/** The Done sent for its newest version, or null. */
	finished?: Finished | null;
}): JSX.Element {
	const newest = versions.at(-1) ?? steps;
	const before = versions.at(-2) ?? null;
	const changed = useMemo(() => changedSteps(before, newest), [before, newest]);
	const [done, place, move] = useStepsPlace(newest);
	const [preview, togglePreview] = useStepPreview(done, newest.steps.length);
	const title = steps.title === "" ? "Steps" : `Steps: ${steps.title}`;
	const popOut = useStepsPopOut();
	const conversation = use(EvalsConversation);
	const card =
		conversation === null
			? null
			: { conversation, title: steps.title, steps: newest };
	const popped = card !== null && isShown(popOut, card);
	const count = newest.steps.length;
	const popButton = canPopOut() && popOut !== null && card !== null && (
		<Button
			variant="outline"
			size="xs"
			onClick={() => (popped ? popOut.close() : void popOut.open(card))}
		>
			<PictureInPicture2Icon />
			{popped ? "Bring back" : "Pop out"}
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
					</span>
				}
			>
				<CardBody
					text={steps.steps.map((step, i) => `${i + 1}. ${step}`).join("\n")}
					lead={false}
				/>
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
				steps={newest}
				done={done}
				place={place}
				move={move}
				preview={preview}
				togglePreview={togglePreview}
				changed={changed}
				hint
			/>
			<DoneBar
				steps={newest}
				done={done}
				finished={finished}
				onSent={() => (popped ? popOut?.close() : undefined)}
			/>
		</CardShell>
	);
}

/** The card in its thread, and nothing in the pop-out, which is the card's own window. */
function StepsPart({ steps }: { steps: Steps }): JSX.Element | null {
	return use(InPopout) ? null : (
		<InMessage>
			<ThreadSteps steps={steps} />
		</InMessage>
	);
}

/** A Steps card in its thread: its versions, and what was asked about it. */
function ThreadSteps({ steps }: { steps: Steps }): JSX.Element {
	const messages = useAuiState((state) => state.thread.messages);
	const index = useAuiState((state) => state.message.index);
	const thread = useMemo(() => {
		const versions = versionsOf(messages, steps.title);
		// Its last version is in a later message than this one.
		const newest = messages.findLastIndex(
			(message) => versionsOf([message], steps.title).length > 0,
		);
		return {
			versions: versions.length === 0 ? [steps] : versions,
			replaced: steps.title !== "" && newest > index,
			finished: finishedOf(messages, steps.title),
		};
	}, [messages, index, steps]);
	return <StepsCard steps={steps} {...thread} />;
}
