import { useReactive } from "@webappwiz/react";
import { type JSX, useContext, useEffect, useState } from "react";
import { Field, FieldLabel } from "#web/components/ui/field.tsx";
import { Input } from "#web/components/ui/input.tsx";
import {
	NativeSelect,
	NativeSelectOption,
} from "#web/components/ui/native-select.tsx";
import { Switch } from "#web/components/ui/switch.tsx";
import { setupReference } from "../prompts";
import type { AreaProgress, FieldProgress } from "../setup";
import { agentFor, NEW } from "./conversation-address";
import { promptConversation, startConversation } from "./conversation-api";
import type { ConversationFeed } from "./conversation-feed";
import { Markdown } from "./markdown";
import { CredField, JourneyDone, SetupIndex, StepForm } from "./setup-form";
import { SetupJourney } from "./setup-journey";
import { SetupContext } from "./setup-state";
import { JOURNEY_ENDS, STEP_BODIES } from "./setup-steps";
import { TopBar } from "./top-bar";

/** Intentional setup: choose an area, then answer its steps a page at a time. */
export function SetupPage({
	feed,
	onOpen,
}: {
	/** Where a conversation starts, or null while `splates server` holds none. */
	feed: ConversationFeed | null;
	/** Opens the conversation started on a step. */
	onOpen: (id: string) => void;
}): JSX.Element {
	const { progress } = useContext(SetupContext);
	const [selected, setSelected] = useState<string | null>(null);
	const area = progress?.areas.find((area) => area.id === selected);
	return (
		<section aria-label="setup" className="flex min-w-0 flex-col gap-8">
			<TopBar title="Setup" />
			{progress !== null &&
				(area ? (
					<Journey
						key={area.id}
						area={area}
						feed={feed}
						onOpen={onOpen}
						onLeave={() => setSelected(null)}
					/>
				) : (
					<SetupIndex areas={progress.areas} onSelect={setSelected} />
				))}
		</section>
	);
}

/** One area as a form, a page at a time, as `SetupJourney` walks it. */
function Journey({
	area,
	feed,
	onOpen,
	onLeave,
}: {
	area: AreaProgress;
	feed: ConversationFeed | null;
	onOpen: (id: string) => void;
	onLeave: () => void;
}): JSX.Element {
	const { settle } = useContext(SetupContext);
	const [journey] = useState(() => new SetupJourney(area));
	const { step, at, next } = useReactive(
		journey,
		(journey) => ({ step: journey.step, at: journey.at, next: journey.next }),
		["changed"],
	);
	useEffect(() => journey.events.on("settled", settle), [journey, settle]);
	if (step === undefined) {
		const End = JOURNEY_ENDS[area.id];
		return (
			<JourneyDone title={area.title} onLeave={onLeave}>
				{End !== undefined && (
					<End feed={feed} onOpen={onOpen} onLeave={onLeave} />
				)}
			</JourneyDone>
		);
	}
	const onAgent =
		feed === null
			? null
			: () => {
					startConversation(
						agentFor(NEW, feed.agents, feed.conversations),
						null,
					)
						.then(async (state) => {
							feed.put(state);
							await promptConversation(state.id, setupReference(step.id));
							onOpen(state.id);
						})
						.catch((error: Error) => journey.failed(error.message));
				};
	const Body = STEP_BODIES[step.id];
	return (
		<StepForm
			key={step.id}
			title={step.title}
			why={<Markdown text={step.why} inline />}
			at={at + 1}
			of={journey.steps.length}
			next={next}
			// Read before the fields lock, since a disabled field sends nothing.
			onNext={(form) => void journey.press(new FormData(form))}
			onAgent={onAgent}
			onLeave={onLeave}
		>
			{Body !== undefined ? (
				<Body step={step} feed={feed} onOpen={onOpen} journey={journey} />
			) : step.fields.length > 0 ? (
				step.fields.map((field) => <StepField key={field.name} field={field} />)
			) : (
				<p>
					<Markdown text={step.user} inline />
				</p>
			)}
		</StepForm>
	);
}

/** One field a step's shape asks, as the page's form sends it. */
function StepField({ field }: { field: FieldProgress }): JSX.Element {
	switch (field.kind) {
		case "cred":
			return (
				<CredField
					name={field.name}
					label={field.label}
					help={
						field.help === null ? undefined : (
							<Markdown text={field.help} inline />
						)
					}
					saved={field.saved}
				/>
			);
		case "text":
			return (
				<Field>
					<FieldLabel htmlFor={field.name}>{field.label}</FieldLabel>
					<Input
						id={field.name}
						name={field.name}
						placeholder={field.placeholder ?? undefined}
					/>
				</Field>
			);
		case "choice":
			return (
				<Field>
					<FieldLabel htmlFor={field.name}>{field.label}</FieldLabel>
					<NativeSelect id={field.name} name={field.name}>
						{field.options.map((option) => (
							<NativeSelectOption key={option.value} value={option.value}>
								{option.label}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</Field>
			);
		case "yes-no":
			return (
				<Field orientation="horizontal">
					<Switch id={field.name} name={field.name} />
					<FieldLabel htmlFor={field.name}>{field.label}</FieldLabel>
				</Field>
			);
	}
}
