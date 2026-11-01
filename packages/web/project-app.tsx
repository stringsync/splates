import { useDisposerEffect, useReactive } from "core/react";
import {
	type ComponentProps,
	type JSX,
	useContext,
	useEffect,
	useState,
} from "react";
import { AddProject } from "./add-project";
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
	// Known to be none only once listed; the page then asks for one rather than
	// reading project APIs that have nothing to answer with.
	const listed = useReactive(projects, (list) => list.projects, ["changed"]);
	if (listed !== null && listed.length === 0 && project === "") {
		return (
			<ProjectListContext value={projects}>
				<FirstOpen />
			</ProjectListContext>
		);
	}
	return (
		<ProjectListContext value={projects}>
			<App {...props} {...feeds.of(project)} />
		</ProjectListContext>
	);
}

/** What a server with no project opens on: what splates is, and a way to add one. */
export function FirstOpen(): JSX.Element {
	return (
		<main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 py-12">
			<h1 className="font-semibold text-xl">Welcome to splates</h1>
			<p className="max-w-sm text-center text-muted-foreground text-sm">
				splates runs many agents on one repository, each in its own git
				worktree, and lands their work on trunk without pull requests. Add a
				repository to begin, or run{" "}
				<code className="font-mono">splates init</code> in it.
			</p>
			<AddProject autoFocus className="w-full max-w-sm" />
		</main>
	);
}
