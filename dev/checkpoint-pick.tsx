import { type JSX, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	DialogDescription,
	DialogFooter,
	DialogHeader,
} from "#dev/components/ui/dialog.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { After } from "../conversations";
import { ProjectName } from "./checkpoint-asked";
import { PhaseTitle } from "./checkpoint-slide";
import type { ProjectChoice } from "./project-api";

/** What a checkpoint does once its agents have answered. */
const AFTERWARDS: {
	after: After;
	label: string;
	detail: string;
}[] = [
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
			"Then arbor dev restarts, on a newer arbor if one is out, and you pick what comes next.",
	},
	{
		after: "resume",
		label: "Checkpoint, restart and resume",
		detail:
			"Then arbor dev restarts, on a newer arbor if one is out, and each agent resumes.",
	},
	{
		after: "shutdown",
		label: "Checkpoint and shut down",
		detail:
			"Then arbor dev shuts down, and the next time it starts, you resume them.",
	},
];

/**
 * The projects to pick, with what follows, and the button that asks; with no
 * agent running, a restart straight away when `arbor dev` can make one.
 */
export function PickSlide({
	projects,
	after,
	onAfter,
	busy,
	newest,
	restartable,
	onClose,
	onAsk,
	onRestart,
}: {
	projects: ProjectChoice[];
	after: After;
	onAfter: (after: After) => void;
	busy: boolean;
	/** A newer arbor, which a restart lands on. */
	newest: string | null;
	restartable: boolean;
	onClose: () => void;
	onAsk: (projects: string[]) => Promise<void>;
	onRestart: () => Promise<void>;
}): JSX.Element {
	const [picked, setPicked] = useState<Set<string> | null>(null);
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
				<PhaseTitle slide="pick" restarted={null} />
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
									onChange={() => onAfter(each.after)}
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
				{projects.length > 0 ? (
					<Button
						disabled={go.length === 0 || busy}
						onClick={() => void onAsk(go)}
					>
						Proceed
					</Button>
				) : (
					restartable && (
						<Button disabled={busy} onClick={() => void onRestart()}>
							{newest === null ? "Restart" : `Restart on ${newest}`}
						</Button>
					)
				)}
			</DialogFooter>
		</>
	);
}
