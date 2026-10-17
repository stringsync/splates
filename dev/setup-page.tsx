import {
	BotIcon,
	CheckIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	RotateCwIcon,
} from "lucide-react";
import { type JSX, useContext, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { setupReference } from "../prompts";
import type { AreaProgress, SetupProgress, StepProgress } from "../setup";
import { saveCred, skipSetupStep } from "./api";
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

/** Intentional setup: choose an area, then walk only its steps. */
export function SetupPage({
	feed,
	onOpen,
}: {
	/** Where a conversation starts, or null while `arbor dev` holds none. */
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
					<Wizard
						key={area.id}
						area={area}
						feed={feed}
						onOpen={onOpen}
						onJourneys={() => setSelected(null)}
					/>
				) : (
					<Chooser progress={progress} onSelect={setSelected} />
				))}
		</section>
	);
}

const AGENT_JOURNEYS = ["opencode", "claude", "codex"];
const DESCRIPTIONS: Record<string, string> = {
	opencode:
		"Install, connect your Go account, choose models and check configuration.",
	claude:
		"Install and sign in, then review Claude's roster entry and models. Checks read the roster only.",
	codex:
		"Install and sign in, then review Codex's roster entry and models. Checks read the roster only.",
	agents: "Review the shared agent roster and model descriptions.",
	"remote-access": "Reach arbor from your phone or another computer.",
	notifications: "Choose where and when arbor notifies you.",
	dictation: "Set up voice input for your prompts.",
};

function Chooser({
	progress,
	onSelect,
}: {
	progress: SetupProgress;
	onSelect: (id: string) => void;
}): JSX.Element {
	const agents = AGENT_JOURNEYS.flatMap((id) =>
		progress.areas.filter((area) => area.id === id),
	);
	const other = progress.areas.filter(
		(area) => !AGENT_JOURNEYS.includes(area.id),
	);
	return (
		<div className="mx-auto flex w-full max-w-xl flex-col gap-8">
			<header className="flex flex-col gap-2">
				<h2 className="text-3xl font-medium">What would you like to set up?</h2>
				<p className="text-muted-foreground">
					Choose a journey. You can leave, revisit or repair it at any time.
				</p>
			</header>
			{[
				{ title: "Agents", areas: agents },
				{ title: "Other machine setup", areas: other },
			].map(
				({ title, areas }) =>
					areas.length > 0 && (
						<section
							key={title}
							aria-label={title}
							className="flex flex-col gap-3"
						>
							<h3 className="font-medium">{title}</h3>
							{areas.map((area) => (
								<div key={area.id} className="flex flex-col gap-2">
									<Button
										variant="outline"
										className="min-h-12 justify-between"
										onClick={() => onSelect(area.id)}
									>
										Set up {area.title}
										<ChevronRightIcon data-icon="inline-end" />
									</Button>
									<p className="text-sm text-muted-foreground">
										{DESCRIPTIONS[area.id]} {area.done} of {area.steps.length}{" "}
										steps done
										{area.skipped > 0 ? ` · ${area.skipped} skipped` : ""}.
									</p>
								</div>
							))}
						</section>
					),
			)}
		</div>
	);
}

interface Placed {
	step: StepProgress;
	area: string;
}

function Wizard({
	area,
	feed,
	onOpen,
	onJourneys,
}: {
	area: AreaProgress;
	onJourneys: () => void;
	feed: ConversationFeed | null;
	onOpen: (id: string) => void;
}): JSX.Element {
	const { refresh, settle } = useContext(SetupContext);
	const steps: Placed[] = area.steps.map((step) => ({
		step,
		area: area.title,
	}));
	// Revisit begins at the first unresolved step, with all steps still reachable.
	const [at, setAt] = useState(() => {
		const next = steps.findIndex(
			({ step }) => step.status === "ready" || step.status === "waiting",
		);
		return next === -1 ? 0 : next;
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
		act(skipSetupStep(step, true).then(settle).then(forward));
	const resume = async (step: StepProgress) => {
		const needed = new Set([step.id]);
		for (const { step: before } of [...steps].reverse()) {
			if (needed.has(before.id)) {
				for (const id of before.after) {
					needed.add(id);
				}
			}
		}
		for (const { step: before } of steps) {
			if (needed.has(before.id) && before.status === "skipped") {
				settle(await skipSetupStep(before.id, false));
			}
		}
	};
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
			<Button
				variant="ghost"
				className="self-start min-h-11"
				onClick={onJourneys}
			>
				<ChevronLeftIcon data-icon="inline-start" /> Back to journeys
			</Button>
			<nav aria-label={`${area.title} steps`} className="flex flex-wrap gap-2">
				{steps.map(({ step }, index) => (
					<Button
						key={step.id}
						variant={at === index ? "secondary" : "ghost"}
						className="min-h-11"
						aria-current={at === index ? "step" : undefined}
						onClick={() => {
							setError(null);
							setAt(index);
						}}
					>
						{index + 1}. {step.title}
					</Button>
				))}
			</nav>
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
						onResume={() => act(resume(here.step))}
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
	onResume,
}: {
	here: Placed;
	onAgent: ((step: string) => void) | null;
	onCheck: () => void;
	feed: ConversationFeed | null;
	onOpen: (id: string) => void;
	onRepair: () => void;
	onResume: () => void;
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
			{step.status === "skipped" && (
				<Button variant="outline" onClick={onResume}>
					Resume this step
				</Button>
			)}
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
			) : step.status === "done" && !/^(claude|codex)-/.test(step.id) ? (
				<p className="flex items-center gap-2 text-lg text-success">
					<CheckIcon className="size-5" /> Done
				</p>
			) : (
				<div className="flex flex-col gap-4">
					{step.status === "done" && (
						<p className="text-success">Saved in roster</p>
					)}
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
					? "Every step in this journey is done. Revisit any step to review it."
					: "Revisit any step left, or go back to journeys to choose another setup."}
			</p>
		</div>
	);
}
