import type { ComponentProps, JSX } from "react";
import { App } from "./app";
import { useShownProject } from "./navigation";

/**
 * The page, for whichever project the address names: render it in place of
 * `App`, and a switch to another project starts that one's page afresh,
 * nothing of the last one's left on it, as loading its address would.
 */
export function ProjectApp(props: ComponentProps<typeof App>): JSX.Element {
	// Keyed, so the last project's feeds, shells and state go with its `App`.
	const project = useShownProject();
	return <App key={project ?? ""} {...props} />;
}
