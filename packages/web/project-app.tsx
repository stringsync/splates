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
 * Render it in place of `App` to show whichever project the address names,
 * switching between projects in place. The project shown becomes the
 * focused one, which a bare address on any device opens.
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
	// One `App` for every project, so the sidebar and bars stay put across a
	// switch; it makes its pages and shells afresh for the new feeds, and the
	// last project's feeds, kept, stop streaming.
	return (
		<ProjectListContext value={projects}>
			<App {...props} {...feeds.of(project)} />
		</ProjectListContext>
	);
}
