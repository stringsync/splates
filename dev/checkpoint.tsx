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
} from "./api";
import { projectUrl } from "./projects";
import { Refusal, useRefusal } from "./refusal";
import { CheckpointState } from "./release";

/** What a checkpoint can do once its agents have answered. */
const AFTERWARDS: { after: After; label: string; detail: string }[] = [
	{
		after: "stop",
		label: "Checkpoint",
		detail: "Each agent brings its ARBOR.md up to date and stops.",
	},
	{
		after: "continue",
		label: "Checkpoint and continue",
		detail: "Then each carries on from it.",
	},
	{
		after: "restart",
		label: "Checkpoint and restart",
		detail:
			"Then arbor dev restarts, on a newer arbor if one is out, and each carries on. Agents in projects left unpicked stop as they are.",
	},
];

/** How a project's checkpoint stands. */
interface Standing {
	asked: ProjectConversation[];
	/** Still to answer. */
	going: number;
	done: number;
	missed: ProjectConversation[];
	/** Live and not yet asked. */
	live: number;
}

function standing(conversations: ProjectConversation[]): Standing {
	const asked = conversations.filter((each) => each.checkpoint !== null);
	const count = (checkpoint: string) =>
		asked.filter((each) => each.checkpoint === checkpoint).length;
	return {
		asked,
		going: count("asked"),
		done: count("done"),
		missed: asked.filter(
			(each) =>
				each.checkpoint === "failed" || each.checkpoint === "unanswered",
		),
		live: conversations.length - asked.length,
	};
}

/**
 * The sidebar's Checkpoint, opening a dialog to checkpoint any of the
 * projects with agents running, and saying how one under way gets on. Asks
 * the server for every project again as `conversations`, this project's,
 * change, and each second while a checkpoint is under way, closing the
 * dialog once it ends. Shown while any project has an agent running, or a
 * checkpoint asked.
 */
export function CheckpointButton({
	conversations,
}: {
	conversations: ConversationState[];
}): JSX.Element | null {
	const [projects, setProjects] = useState<ProjectChoice[]>([]);
	const [open, setOpen] = useState(false);
	const { refusal, refuse } = useRefusal();
	const load = useCallback(
		() =>
			listProjects().then(setProjects, (error: unknown) =>
				refuse("Projects not listed", error),
			),
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
	const shown = projects.filter(
		(each) => !each.gone && each.conversations.length > 0,
	);
	const all = standing(shown.flatMap((each) => each.conversations));
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
	// Closes the dialog once a checkpoint under way ends.
	const going = useRef(all.going);
	useEffect(() => {
		if (going.current > 0 && all.going === 0) {
			setOpen(false);
		}
		going.current = all.going;
	}, [all.going]);
	if (shown.length === 0) {
		return null;
	}
	return (
		<>
			<button
				type="button"
				data-row
				onClick={() => setOpen(true)}
				title={
					all.missed.length > 0
						? `Not checkpointed: ${all.missed.map((each) => each.name).join(", ")}`
						: undefined
				}
				className={cn(
					"flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-1.5 text-left text-muted-foreground text-xs hover:bg-muted",
					all.going === 0 && all.missed.length > 0 && "text-destructive",
				)}
			>
				{all.going > 0 ? (
					<Loader2Icon className="size-3.5 animate-spin" />
				) : all.asked.length > 0 && all.missed.length === 0 ? (
					<CheckIcon className="size-3.5 text-success" />
				) : (
					<FlagIcon className="size-3.5" />
				)}
				<span className="flex-1 truncate">
					{all.going > 0
						? `Checkpointing ${all.asked.length - all.going} of ${all.asked.length}`
						: all.asked.length === 0
							? "Checkpoint"
							: all.missed.length === 0
								? `Checkpointed ${all.done}`
								: `Checkpointed ${all.done}, ${all.missed.length} not`}
				</span>
			</button>
			<Refusal refusal={refusal} className="px-3 pb-1.5" />
			<CheckpointDialog
				open={open}
				onOpenChange={setOpen}
				projects={shown}
				onChange={load}
			/>
		</>
	);
}

/**
 * Picks projects to checkpoint and what follows, this one picked to start
 * with. A project whose checkpoint is asked lists how each of its agents
 * gets on instead of being picked, with Dismiss.
 */
function CheckpointDialog({
	open,
	onOpenChange,
	projects,
	onChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projects: ProjectChoice[];
	onChange: () => void;
}): JSX.Element {
	const [picked, setPicked] = useState<Set<string> | null>(null);
	const [after, setAfter] = useState<After>("stop");
	const { refusal, refuse } = useRefusal();
	useEffect(() => {
		if (!open) {
			setPicked(null);
			setAfter("stop");
		}
	}, [open]);
	const pickable = projects.filter(
		(each) => standing(each.conversations).asked.length === 0,
	);
	// This project to start with, once the dialog knows which are pickable.
	const chosen =
		picked ??
		new Set(pickable.filter((each) => each.here).map((each) => each.slug));
	const toggle = (slug: string) => {
		const next = new Set(chosen);
		if (!next.delete(slug)) {
			next.add(slug);
		}
		setPicked(next);
	};
	const go = [...chosen].filter((slug) =>
		pickable.some((each) => each.slug === slug),
	);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Checkpoint</DialogTitle>
					<DialogDescription>
						Each agent in the projects you pick brings its ARBOR.md up to date,
						so the next one can carry on from it.
					</DialogDescription>
				</DialogHeader>
				<ul aria-label="projects" className="flex flex-col gap-1">
					{projects.map((project) => (
						<ProjectRow
							key={project.slug}
							project={project}
							picked={chosen.has(project.slug)}
							onPick={() => toggle(project.slug)}
							onOpen={() => onOpenChange(false)}
							onChange={onChange}
							refuse={refuse}
						/>
					))}
				</ul>
				{pickable.length > 0 && (
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
				)}
				<Refusal refusal={refusal} />
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Close
					</Button>
					{pickable.length > 0 && (
						<Button
							disabled={go.length === 0}
							onClick={() =>
								checkpointProjects(go, after).then(
									() => {
										setPicked(null);
										onChange();
									},
									(error: unknown) => refuse("Not checkpointed", error),
								)
							}
						>
							{go.length > 1
								? `Checkpoint ${go.length} projects`
								: "Checkpoint"}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** One project in the dialog: a box to pick it, or how its checkpoint gets on. */
function ProjectRow({
	project,
	picked,
	onPick,
	onOpen,
	onChange,
	refuse,
}: {
	project: ProjectChoice;
	picked: boolean;
	onPick: () => void;
	onOpen: () => void;
	onChange: () => void;
	refuse: (what: string, error: unknown) => void;
}): JSX.Element {
	const { asked, live } = standing(project.conversations);
	const href = (id: string) => {
		const url = new URL(projectUrl(project));
		url.hash = `#conversations/${id}`;
		return url.toString();
	};
	const name = (
		<span className="flex min-w-0 flex-1 items-baseline gap-2">
			<span className="truncate font-medium text-sm">{project.slug}</span>
			{project.here && (
				<span className="shrink-0 text-muted-foreground text-xs">
					this project
				</span>
			)}
		</span>
	);
	if (asked.length === 0) {
		return (
			<li>
				<label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted">
					<input
						type="checkbox"
						aria-label={`Checkpoint ${project.slug}`}
						checked={picked}
						onChange={onPick}
						className="accent-primary"
					/>
					{name}
					<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
						{live} live
					</span>
				</label>
			</li>
		);
	}
	return (
		<li className="flex flex-col rounded-md border px-2 py-1.5">
			<div className="flex items-center gap-2">
				{name}
				<Button
					size="xs"
					variant="ghost"
					onClick={() =>
						dismissCheckpoint(project.slug).then(onChange, (error: unknown) =>
							refuse("Not dismissed", error),
						)
					}
				>
					Dismiss
				</Button>
			</div>
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
}
