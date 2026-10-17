import {
	BotIcon,
	CheckIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	RotateCwIcon,
} from "lucide-react";
import { type JSX, useContext, useEffect, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { setupReference } from "../prompts";
import type { SetupProgress, StepProgress } from "../setup";
import { saveCred, seeSetup, skipSetupStep } from "./api";
import { agentFor, NEW } from "./conversation-address";
import { promptConversation, startConversation } from "./conversation-api";
import type { ConversationFeed } from "./conversation-feed";
import { Paste } from "./cred-paste";
import { Markdown } from "./markdown";
import { OpenCodeControls } from "./setup-opencode";
import { OpenCodeModelControls } from "./setup-opencode-models";
import { OpenCodeReadyControls } from "./setup-opencode-ready";
import { SetupContext } from "./setup-state";
import { TopBar } from "./top-bar";

/**
 * Setup as a wizard: one large question at a time, its area above it, why
 * it matters and the one thing to do, under a thin bar of how much is done.
 * Back and Next walk every step, done or not; Skip puts off an optional one.
 * Opening it marks setup seen, so the nudge towards it stops.
 */
export function SetupPage({
	feed,
	onOpen,
}: {
	/** Where a conversation starts, or null while `arbor dev` holds none. */
	feed: ConversationFeed | null;
	/** Opens the conversation started on a step. */
	onOpen: (id: string) => void;
}): JSX.Element {
	const { progress, settle } = useContext(SetupContext);
	const fresh = progress?.fresh ?? false;
	useEffect(() => {
		if (fresh) {
			seeSetup().then(settle, () => {});
		}
	}, [fresh, settle]);
	return (
		<section aria-label="setup" className="flex min-w-0 flex-col gap-8">
			<TopBar title="Setup" />
			{progress !== null && (
				<Wizard progress={progress} feed={feed} onOpen={onOpen} />
			)}
		</section>
	);
}

interface Placed {
	step: StepProgress;
	area: string;
}

function Wizard({
	progress,
	feed,
	onOpen,
}: {
	progress: SetupProgress;
	feed: ConversationFeed | null;
	onOpen: (id: string) => void;
}): JSX.Element {
	const { refresh, settle } = useContext(SetupContext);
	const steps: Placed[] = progress.areas.flatMap((area) =>
		area.steps.map((step) => ({ step, area: area.title })),
	);
	// Starts on the step to do next; past the last is the end.
	const [at, setAt] = useState(() => {
		const next = steps.findIndex(({ step }) => step.id === progress.next);
		return next === -1 ? steps.length : next;
	});
	const [error, setError] = useState<string | null>(null);
	const done = steps.filter(({ step }) => step.status === "done").length;
	const here = steps[at] ?? null;
	const act = (doing: Promise<unknown>) =>
		doing.then(
			() => setError(null),
			(caught: Error) => setError(caught.message),
		);
	const forward = () => {
		setError(null);
		setAt(Math.min(at + 1, steps.length));
	};
	const skip = (step: string) =>
		act(skipSetupStep(step, true).then(settle)).then(forward);
	const startAgent =
		feed === null
			? null
			: (step: string) =>
					act(
						startConversation(
							agentFor(NEW, feed.agents, feed.conversations),
							null,
						).then(async (state) => {
							feed.put(state);
							await promptConversation(state.id, setupReference(step));
							onOpen(state.id);
						}),
					);

	return (
		<div className="mx-auto flex min-h-[70vh] w-full max-w-xl flex-col gap-8">
			<div className="flex items-center gap-3">
				<div
					role="progressbar"
					aria-label="setup done"
					aria-valuenow={done}
					aria-valuemin={0}
					aria-valuemax={steps.length}
					className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
				>
					<div
						className="h-full bg-primary transition-[width]"
						style={{ width: `${(done / Math.max(steps.length, 1)) * 100}%` }}
					/>
				</div>
				<span className="text-muted-foreground text-xs tabular-nums">
					{done} of {steps.length} done
				</span>
			</div>
			<div className="flex flex-1 flex-col justify-center gap-8">
				{here === null ? (
					<End done={done === steps.length} />
				) : (
					<Question
						key={here.step.id}
						here={here}
						onAgent={startAgent}
						onCheck={refresh}
						feed={feed}
						onOpen={onOpen}
						onRepair={() =>
							setAt(
								steps.findIndex(({ step }) => step.id === "opencode-install"),
							)
						}
					/>
				)}
				{error !== null && (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				)}
			</div>
			<div className="flex items-center gap-2">
				<Button
					variant="ghost"
					disabled={at === 0}
					onClick={() => setAt(at - 1)}
				>
					<ChevronLeftIcon /> Back
				</Button>
				<span className="flex-1" />
				{here?.step.optional &&
					here.step.status !== "done" &&
					here.step.status !== "skipped" && (
						<Button
							variant="ghost"
							className="text-muted-foreground"
							onClick={() => skip(here.step.id)}
						>
							Skip
						</Button>
					)}
				{here !== null && (
					<Button onClick={forward}>
						{at === steps.length - 1 ? "Finish" : "Next"} <ChevronRightIcon />
					</Button>
				)}
			</div>
		</div>
	);
}

/** One step, asked as a question: why it matters, then the one thing to do. */
function Question({
	here: { step, area },
	onAgent,
	onCheck,
	feed,
	onOpen,
	onRepair,
}: {
	here: Placed;
	onAgent: ((step: string) => void) | null;
	onCheck: () => void;
	feed: ConversationFeed | null;
	onOpen: (id: string) => void;
	onRepair: () => void;
}): JSX.Element {
	return (
		<article aria-label={`step ${step.id}`} className="flex flex-col gap-8">
			<header className="flex flex-col gap-3">
				<span className="text-muted-foreground text-xs uppercase tracking-wide">
					{area}
					{step.optional && " · optional"}
				</span>
				<h2 className="font-medium text-3xl">{step.title}</h2>
				<p className="text-lg text-muted-foreground">
					<Markdown text={step.why} inline />
				</p>
			</header>
			{step.id === "opencode-ready" ? (
				<OpenCodeReadyControls
					feed={feed}
					onOpen={onOpen}
					onRepair={onRepair}
				/>
			) : step.id === "opencode-models" ? (
				<OpenCodeModelControls />
			) : step.id === "opencode-install" || step.id === "opencode-connect" ? (
				<OpenCodeControls step={step.id} />
			) : step.status === "done" ? (
				<p className="flex items-center gap-2 text-lg text-success">
					<CheckIcon className="size-5" /> Done
				</p>
			) : (
				<div className="flex flex-col gap-4">
					<p className="text-lg">
						<Markdown text={step.user} inline />
					</p>
					{step.status === "skipped" && (
						<p className="text-muted-foreground text-sm">Skipped for now.</p>
					)}
					{step.cred !== null && (
						<Paste
							name={step.cred}
							save={(value) => saveCred(step.cred ?? "", value, "device")}
							onSaved={onCheck}
						/>
					)}
					{step.problem !== null && (
						<p role="alert" className="text-destructive text-sm">
							{step.problem}
						</p>
					)}
					<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
						{onAgent !== null && (
							<Button
								variant="link"
								className="h-auto gap-1.5 p-0"
								onClick={() => onAgent(step.id)}
							>
								<BotIcon /> Set it up with an agent
							</Button>
						)}
						<Button
							variant="link"
							className="h-auto gap-1.5 p-0 text-muted-foreground"
							onClick={onCheck}
						>
							<RotateCwIcon /> Check again
						</Button>
					</div>
				</div>
			)}
		</article>
	);
}

/** Past the last step: all done, or what is left to come back to. */
function End({ done }: { done: boolean }): JSX.Element {
	return (
		<div className="flex flex-col gap-3">
			<h2 className="font-medium text-3xl">
				{done ? "You're all set." : "That's every step."}
			</h2>
			<p className="text-lg text-muted-foreground">
				{done
					? "Everything arbor can set up on this machine is set up."
					: "Go Back to any step left, or come back to Setup from Settings."}
			</p>
		</div>
	);
}
