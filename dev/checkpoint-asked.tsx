import { CheckIcon, CircleAlertIcon, Loader2Icon } from "lucide-react";
import type { JSX } from "react";
import { cn } from "#dev/lib/utils.ts";
import type { Checkpoint } from "../conversations";
import { standing } from "./checkpoint-slide";
import type { ProjectChoice, ProjectConversation } from "./project-api";
import { projectUrl } from "./projects";

/** Each project's agents a checkpoint asked, and how each got on. */
export function AskedList({
	projects,
	onOpen,
	state,
}: {
	projects: ProjectChoice[];
	onOpen: () => void;
	/** How one got on, in a word. */
	state: (conversation: ProjectConversation) => JSX.Element | null;
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
										{state(each)}
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

/** Where one's checkpoint stands, if it has one. */
export function checkpointed({
	checkpoint,
}: ProjectConversation): JSX.Element | null {
	return checkpoint === null ? null : (
		<CheckpointState checkpoint={checkpoint} />
	);
}

/** An agent back at work after its checkpoint. */
export function CheckpointResumed(): JSX.Element {
	return (
		<span
			role="img"
			aria-label="Resumed"
			title="Resumed"
			className="flex shrink-0 self-center text-success"
		>
			<CheckIcon className="size-3.5" />
		</span>
	);
}

/** An agent told to carry on after its checkpoint, not yet back, as an icon. */
export function Resuming(): JSX.Element {
	return (
		<span
			role="img"
			aria-label="Resuming"
			title="Resuming"
			className="flex shrink-0 self-center text-muted-foreground"
		>
			<Loader2Icon className="size-3.5 animate-spin" />
		</span>
	);
}

export function ProjectName({
	project,
}: {
	project: ProjectChoice;
}): JSX.Element {
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

const SAYS: Record<Checkpoint, string> = {
	asked: "Checkpointing",
	done: "Checkpointed",
	failed: "Failed",
	unanswered: "No response",
};

/**
 * How far one conversation's checkpoint has got, as an icon, the word in its
 * name and tooltip.
 */
function CheckpointState({
	checkpoint,
}: {
	checkpoint: Checkpoint;
}): JSX.Element {
	return (
		<span
			role="img"
			aria-label={SAYS[checkpoint]}
			title={SAYS[checkpoint]}
			className={cn(
				"flex shrink-0 self-center",
				checkpoint === "done"
					? "text-success"
					: checkpoint === "asked"
						? "text-muted-foreground"
						: "text-destructive",
			)}
		>
			{checkpoint === "asked" ? (
				<Loader2Icon className="size-3.5 animate-spin" />
			) : checkpoint === "done" ? (
				<CheckIcon className="size-3.5" />
			) : (
				<CircleAlertIcon className="size-3.5" />
			)}
		</span>
	);
}
