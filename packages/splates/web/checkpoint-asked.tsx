import type { JSX } from "react";
import { standing } from "./checkpoint-slide";
import type { ProjectChoice } from "./project-api";
import { projectUrl } from "./project-places";

/**
 * The agents a checkpoint missed, each a link to its conversation, so a run
 * that went well names no one.
 */
export function MissedList({
	projects,
	onOpen,
}: {
	projects: ProjectChoice[];
	onOpen: () => void;
}): JSX.Element | null {
	const missed = projects.flatMap((project) =>
		standing(project.conversations).missed.map((each) => {
			const url = new URL(projectUrl(project));
			url.hash = `#conversations/${each.id}`;
			return { ...each, href: url.toString(), project: project.slug };
		}),
	);
	if (missed.length === 0) {
		return null;
	}
	return (
		<p className="text-destructive text-xs">
			Missed the checkpoint:{" "}
			{missed.map((each, index) => (
				<span key={each.id}>
					{index > 0 && ", "}
					<a
						href={each.href}
						onClick={onOpen}
						title={each.project}
						className="underline underline-offset-2"
					>
						{each.name}
					</a>
				</span>
			))}
			.
		</p>
	);
}
