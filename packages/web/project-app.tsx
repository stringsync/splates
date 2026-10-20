import { type ComponentProps, type JSX, useContext, useState } from "react";
import { App } from "./app";
import { EverywhereContext } from "./everywhere-context";
import { useShownProject } from "./navigation";
import { ProjectFeeds, type ProjectFeedsOptions } from "./project-feeds";

/**
 * The page, for whichever project the address names: render it in place of
 * `App`. A switch to another project starts that one's page afresh, nothing
 * of the last one's left on it, but draws at once from the feeds
 * `ProjectFeeds` keeps.
 */
export function ProjectApp({
	copies,
	conversationIds,
	...props
}: Omit<ComponentProps<typeof App>, "feed" | "talk"> &
	Pick<ProjectFeedsOptions, "copies" | "conversationIds">): JSX.Element {
	const project = useShownProject() ?? "";
	const everywhere = useContext(EverywhereContext);
	const [feeds] = useState(
		() => new ProjectFeeds(everywhere, { ...props, copies, conversationIds }),
	);
	// Keyed, so the last project's shells and state go with its `App`; its
	// feeds, kept, stop streaming as it goes.
	return <App key={project} {...props} {...feeds.of(project)} />;
}
