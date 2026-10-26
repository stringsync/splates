import { useDisposerEffect } from "@webappwiz/react";
import {
	type ComponentProps,
	type JSX,
	useContext,
	useEffect,
	useState,
} from "react";
import { App } from "./app";
import { EverywhereContext, useHoldEverywhere } from "./everywhere-context";
import { useShownProject } from "./navigation";
import { focusProject } from "./project-api";
import { ProjectFeeds, type ProjectFeedsOptions } from "./project-feeds";
import { ProjectList, ProjectListContext } from "./project-list";

/**
 * The page, for whichever project the address names: render it in place of
 * `App`. A switch to another project starts that one's page afresh, nothing
 * of the last one's left on it, but draws at once from the feeds
 * `ProjectFeeds` keeps. The project shown is the one project of the page,
 * however it came to be shown: a pick in any switcher, a row of another
 * project's, a link, Back. It becomes the focused one too, so a bare address
 * on any device opens it next.
 */
export function ProjectApp({
	copies,
	conversationIds,
	offlineAfter,
	wall,
	...props
}: Omit<ComponentProps<typeof App>, "feed" | "talk"> &
	Pick<
		ProjectFeedsOptions,
		"copies" | "conversationIds" | "offlineAfter" | "wall"
	>): JSX.Element {
	const project = useShownProject() ?? "";
	const everywhere = useContext(EverywhereContext);
	// Held for as long as the page is open, so a switch to a project not
	// shown before always has its tasks and conversations to draw from.
	useHoldEverywhere();
	const [feeds] = useState(
		() =>
			new ProjectFeeds(everywhere, {
				...props,
				copies,
				conversationIds,
				offlineAfter,
				wall,
			}),
	);
	// Kept for the page too, so the switcher opens on a list already read.
	const [projects] = useState(() => new ProjectList(everywhere));
	useDisposerEffect((disposer) => disposer.use(projects.start()), [projects]);
	useEffect(() => {
		if (project !== "") {
			// Refreshed after, so every switcher marks it current at once.
			void focusProject(project).then(
				() => projects.refresh(),
				() => {},
			);
		}
	}, [project, projects]);
	// Keyed, so the last project's shells and state go with its `App`; its
	// feeds, kept, stop streaming as it goes.
	return (
		<ProjectListContext value={projects}>
			<App key={project} {...props} {...feeds.of(project)} />
		</ProjectListContext>
	);
}
