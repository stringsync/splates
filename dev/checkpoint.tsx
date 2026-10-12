import { CheckIcon, FlagIcon, Loader2Icon } from "lucide-react";
import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { Duration, SystemTimer } from "webappwiz/time";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#dev/components/ui/dialog.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { After, ConversationState } from "../conversations";
import {
	checkpointProjects,
	dismissCheckpoint,
	listProjects,
	type ProjectChoice,
	type ProjectConversation,
	restartFromCheckpoint,
	resumeCheckpoint,
	showRelease,
} from "./api";
import { projectUrl } from "./projects";
import { Refusal, useRefusal } from "./refusal";
import { CheckpointState } from "./release";

/** What a checkpoint does once its agents have answered. */
const AFTERWARDS: { after: After; label: string; detail: string }[] = [
	{
		after: "stop",
		label: "Checkpoint",
		detail:
			"Each agent brings its ARBOR.md up to date and stops, then you pick what comes next.",
	},
	{
		after: "restart",
		label: "Checkpoint and restart",
		detail:
			"Then arbor dev restarts, on a newer arbor if one is out, and each carries on. Agents in projects left unpicked stop as they are.",
	},
];

/** How a checkpoint stands. */
interface Standing {
	asked: ProjectConversation[];
	/** Still to answer. */
	going: number;
	missed: ProjectConversation[];
}

function standing(conversations: ProjectConversation[]): Standing {
	const asked = conversations.filter((each) => each.checkpoint !== null);
	return {
		asked,
		going: asked.filter((each) => each.checkpoint === "asked").length,
		missed: asked.filter(
			(each) =>
				each.checkpoint === "failed" || each.checkpoint === "unanswered",
		),
	};
}

/**
 * Where the dialog is: picking projects, waiting on agents, done with them
 * stopped, or ended with them carrying on.
 */
type Slide = "pick" | "going" | "done" | "ended";

function slideOf({ asked, going }: Standing): Slide {
	return asked.length === 0 ? "pick" : going > 0 ? "going" : "done";
}

/** How long a checkpoint whose agents carried on still says it is done. */
const ENDED = Duration.mins(1);

/** The projects the dialog offers: those with agents running. */
function offered(projects: ProjectChoice[]): ProjectChoice[] {
	return projects.filter((each) => !each.gone && each.conversations.length > 0);
}

/**
 * The sidebar's Checkpoint, opening a dialog to checkpoint any of the
 * projects with agents running, which says how one under way gets on, then
 * slides on to what to do once it is done. The button says how it stands,
 * so the dialog can be closed meanwhile and opened again from it, and still
 * says it is done for a minute after its agents carry on. Asks the server
 * for every project again as `conversations`, this project's, change, and
 * each second while a checkpoint is under way or the dialog is open.
 */
export function CheckpointButton({
	conversations,
}: {
	conversations: ConversationState[];
}): JSX.Element {
	const [projects, setProjects] = useState<ProjectChoice[]>([]);
	const [open, setOpen] = useState(false);
	// The projects of the checkpoint that ended last, while it says so.
	const [ended, setEnded] = useState<ProjectChoice[] | null>(null);
	// Those of the checkpoint under way or done, for when it ends.
	const last = useRef<ProjectChoice[]>([]);
	// Closed once done, so its end says nothing, stopped as its agents are.
	const forgotten = useRef(false);
	const { refusal, refuse } = useRefusal();
	const load = useCallback(
		() =>
			listProjects().then(setProjects, (error: unknown) => {
				// Unreachable, as while arbor dev restarts: the next ask finds it.
				if (!(error instanceof TypeError)) {
					refuse("Projects not listed", error);
				}
			}),
		[refuse],
	);
	// A change here is the one the page hears of; others come by asking.
	const here = conversations
		.map((each) => `${each.id}:${each.status}:${each.checkpoint}`)
		.join();
	useEffect(() => {
		void here;
		void load();
	}, [here, load]);
	const shown = offered(projects);
	const all = standing(shown.flatMap((each) => each.conversations));
	const live = slideOf(all);
	const slide = live === "pick" && ended !== null ? "ended" : live;
	useEffect(() => {
		const shown = offered(projects);
		if (
			slideOf(standing(shown.flatMap((each) => each.conversations))) !== "pick"
		) {
			last.current = shown;
			setEnded(null);
		} else {
			if (last.current.length > 0 && !forgotten.current) {
				setEnded(last.current);
			}
			last.current = [];
			forgotten.current = false;
		}
	}, [projects]);
	useEffect(() => {
		if (ended === null) {
			return;
		}
		const shown = new SystemTimer().setTimeout(() => setEnded(null), ENDED);
		return () => shown.dispose();
	}, [ended]);
	useEffect(() => {
		if (all.going === 0 && !open) {
			return;
		}
		const tick = new SystemTimer().setInterval(
			() => void load(),
			Duration.secs(1),
		);
		return () => tick.dispose();
	}, [all.going, open, load]);
	return (
		<>
			<button
				type="button"
				data-row
				onClick={() => setOpen(true)}
				className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-1.5 text-left text-muted-foreground text-xs hover:bg-muted"
			>
				{slide === "going" ? (
					<Loader2Icon className="size-3.5 animate-spin" />
				) : slide === "pick" ? (
					<FlagIcon className="size-3.5" />
				) : (
					<CheckIcon className="size-3.5 text-success" />
				)}
				<span className="flex-1 truncate">
					{slide === "going"
						? "Checkpoint under way"
						: slide === "pick"
							? "Checkpoint"
							: "Checkpoint done"}
				</span>
			</button>
			<Refusal refusal={refusal} className="px-3 pb-1.5" />
			<CheckpointDialog
				open={open}
				onClose={() => setOpen(false)}
				onForget={() => {
					forgotten.current = true;
				}}
				projects={slide === "ended" ? (ended ?? []) : shown}
				ended={slide === "ended"}
				onChange={load}
			/>
		</>
	);
}

/**
 * Picks projects to checkpoint and what follows, this one picked to start
 * with; then lists how each agent asked gets on; then, once all have
 * answered, offers to resume them, restart, or retry those it missed; and
 * once they carry on, says so, while `ended`. Closing it once done leaves
 * the agents stopped and forgets the checkpoint.
 */
function CheckpointDialog({
	open,
	onClose,
	onForget,
	projects,
	ended,
	onChange,
}: {
	open: boolean;
	onClose: () => void;
	/** Forgets a done checkpoint, whose agents stay stopped. */
	onForget: () => void;
	projects: ProjectChoice[];
	ended: boolean;
	onChange: () => Promise<void>;
}): JSX.Element {
	const all = standing(projects.flatMap((each) => each.conversations));
	const slide: Slide = ended ? "ended" : slideOf(all);
	const { refusal, refuse } = useRefusal();
	const [busy, setBusy] = useState(false);
	/** Does `write`, then asks again, saying why when refused. */
	const act = (write: () => Promise<void>, failed: string) => {
		setBusy(true);
		return write()
			.then(onChange, (error: unknown) => refuse(failed, error))
			.finally(() => setBusy(false));
	};
	const close = () => {
		if (slide !== "done") {
			onClose();
			return;
		}
		const asked = projects.filter(
			(each) => standing(each.conversations).asked.length > 0,
		);
		onForget();
		void act(
			() =>
				Promise.all(asked.map((each) => dismissCheckpoint(each.slug))).then(
					() => {},
				),
			"Not dismissed",
		).then(onClose);
	};
	return (
		<Dialog open={open} onOpenChange={(next) => !next && close()}>
			<DialogContent className="sm:max-w-md">
				{/* Keyed, so each slide comes in on its own; ended is done still. */}
				<div
					key={slide === "ended" ? "done" : slide}
					className="grid gap-4 duration-200 animate-in fade-in-0 slide-in-from-right-8"
				>
					{slide === "pick" ? (
						<PickSlide
							projects={projects}
							onClose={onClose}
							onAsk={(go, after) =>
								act(() => checkpointProjects(go, after), "Not checkpointed")
							}
						/>
					) : (
						<>
							<DialogHeader>
								<DialogTitle>
									{slide === "going"
										? "Checkpoint under way"
										: "Checkpoint done"}
								</DialogTitle>
								<DialogDescription>
									{slide === "going"
										? "Each agent is bringing its ARBOR.md up to date."
										: summary(all, slide === "ended")}
								</DialogDescription>
							</DialogHeader>
							<AskedList projects={projects} onOpen={onClose} />
							<Refusal refusal={refusal} />
							{slide !== "done" ? (
								<DialogFooter>
									<Button variant="outline" onClick={onClose}>
										Close
									</Button>
								</DialogFooter>
							) : (
								<DoneActions
									standing={all}
									projects={projects}
									busy={busy}
									onClose={close}
									act={act}
								/>
							)}
						</>
					)}
				</div>
				{slide === "pick" && <Refusal refusal={refusal} />}
			</DialogContent>
		</Dialog>
	);
}

/** What a done checkpoint came to, in a sentence, its agents `resumed` or not. */
function summary({ asked, missed }: Standing, resumed: boolean): string {
	const done = asked.length - missed.length;
	const stopped = `${done} ${done === 1 ? "agent" : "agents"} checkpointed and ${resumed ? "carried on" : "stopped"}.`;
	return missed.length === 0
		? stopped
		: `${stopped} ${missed.length} missed: ${missed.map((each) => each.name).join(", ")}.`;
}

/** The projects to pick, with what follows, and the button that asks. */
function PickSlide({
	projects,
	onClose,
	onAsk,
}: {
	projects: ProjectChoice[];
	onClose: () => void;
	onAsk: (projects: string[], after: After) => Promise<void>;
}): JSX.Element {
	const [picked, setPicked] = useState<Set<string> | null>(null);
	const [after, setAfter] = useState<After>("stop");
	// This project to start with, once the dialog knows which there are.
	const chosen =
		picked ??
		new Set(projects.filter((each) => each.here).map((each) => each.slug));
	const toggle = (slug: string) => {
		const next = new Set(chosen);
		if (!next.delete(slug)) {
			next.add(slug);
		}
		setPicked(next);
	};
	const go = [...chosen].filter((slug) =>
		projects.some((each) => each.slug === slug),
	);
	return (
		<>
			<DialogHeader>
				<DialogTitle>Checkpoint</DialogTitle>
				<DialogDescription>
					Each agent in the projects you pick brings its ARBOR.md up to date, so
					the next one can carry on from it.
				</DialogDescription>
			</DialogHeader>
			{projects.length === 0 ? (
				<p className="text-muted-foreground text-sm">No agent is running.</p>
			) : (
				<>
					<ul aria-label="projects" className="flex flex-col gap-1">
						{projects.map((project) => (
							<li key={project.slug}>
								<label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted">
									<input
										type="checkbox"
										aria-label={`Checkpoint ${project.slug}`}
										checked={chosen.has(project.slug)}
										onChange={() => toggle(project.slug)}
										className="accent-primary"
									/>
									<ProjectName project={project} />
									<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
										{project.conversations.length} live
									</span>
								</label>
							</li>
						))}
					</ul>
					<fieldset className="flex flex-col gap-1">
						<legend className="mb-1 text-muted-foreground text-xs">Then</legend>
						{AFTERWARDS.map((each) => (
							<label
								key={each.after}
								className={cn(
									"flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2",
									after === each.after && "border-primary bg-accent",
								)}
							>
								<input
									type="radio"
									name="after"
									value={each.after}
									checked={after === each.after}
									onChange={() => setAfter(each.after)}
									className="mt-1 accent-primary"
								/>
								<span className="flex flex-col gap-0.5">
									<span className="text-sm">{each.label}</span>
									<span className="text-muted-foreground text-xs">
										{each.detail}
									</span>
								</span>
							</label>
						))}
					</fieldset>
				</>
			)}
			<DialogFooter>
				<Button variant="outline" onClick={onClose}>
					Close
				</Button>
				{projects.length > 0 && (
					<Button
						disabled={go.length === 0}
						onClick={() => void onAsk(go, after)}
					>
						{go.length > 1 ? `Checkpoint ${go.length} projects` : "Checkpoint"}
					</Button>
				)}
			</DialogFooter>
		</>
	);
}

/** The Done slide's way on: resume, restart, retry those missed, or close. */
function DoneActions({
	standing: { asked, missed },
	projects,
	busy,
	onClose,
	act,
}: {
	standing: Standing;
	projects: ProjectChoice[];
	busy: boolean;
	onClose: () => void;
	act: (write: () => Promise<void>, failed: string) => Promise<void>;
}): JSX.Element {
	// A newer arbor, if one is out, is what a restart lands on.
	const [newest, setNewest] = useState<string | null>(null);
	useEffect(() => {
		showRelease().then(
			(release) => setNewest(release.newest),
			() => {},
		);
	}, []);
	const retry = () => {
		const ids = new Set(missed.map((each) => each.id));
		const slugs = projects
			.filter((each) => each.conversations.some((one) => ids.has(one.id)))
			.map((each) => each.slug);
		return act(
			() => checkpointProjects(slugs, "stop", [...ids]),
			"Not checkpointed",
		);
	};
	const done = asked.length - missed.length;
	return (
		<DialogFooter>
			<Button variant="outline" disabled={busy} onClick={onClose}>
				Close
			</Button>
			{missed.length > 0 && (
				<Button variant="outline" disabled={busy} onClick={() => void retry()}>
					Retry missed
				</Button>
			)}
			<Button
				variant="outline"
				disabled={busy}
				onClick={() => void act(restartFromCheckpoint, "Not restarted")}
			>
				{newest === null ? "Restart" : `Restart on ${newest}`}
			</Button>
			{done > 0 && (
				<Button
					disabled={busy}
					onClick={() => void act(resumeCheckpoint, "Not resumed")}
				>
					Resume
				</Button>
			)}
		</DialogFooter>
	);
}

/** Each project's agents a checkpoint asked, and how each got on. */
function AskedList({
	projects,
	onOpen,
}: {
	projects: ProjectChoice[];
	onOpen: () => void;
}): JSX.Element {
	return (
		<ul aria-label="agents" className="flex flex-col gap-2">
			{projects.map((project) => {
				const { asked } = standing(project.conversations);
				if (asked.length === 0) {
					return null;
				}
				const href = (id: string) => {
					const url = new URL(projectUrl(project));
					url.hash = `#conversations/${id}`;
					return url.toString();
				};
				return (
					<li key={project.slug} className="flex flex-col gap-0.5">
						<span className="flex px-1.5">
							<ProjectName project={project} />
						</span>
						<ul className="flex flex-col">
							{asked.map((each) => (
								<li key={each.id}>
									<a
										href={href(each.id)}
										onClick={onOpen}
										className="flex items-baseline gap-2 rounded-md px-1.5 py-0.5 text-xs hover:bg-muted"
									>
										<span className="min-w-0 flex-1 truncate">{each.name}</span>
										{each.checkpoint !== null && (
											<CheckpointState checkpoint={each.checkpoint} />
										)}
									</a>
								</li>
							))}
						</ul>
					</li>
				);
			})}
		</ul>
	);
}

function ProjectName({ project }: { project: ProjectChoice }): JSX.Element {
	return (
		<span className="flex min-w-0 flex-1 items-baseline gap-2">
			<span className="truncate font-medium text-sm">{project.slug}</span>
			{project.here && (
				<span className="shrink-0 text-muted-foreground text-xs">
					this project
				</span>
			)}
		</span>
	);
}
