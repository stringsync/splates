import { type ComponentType, type JSX, lazy, Suspense } from "react";

/**
 * A page that is its own script chunk, fetched when it is first opened rather
 * than with the app. Until it arrives the page is blank, which is a beat
 * longer than the app already on screen and never a spinner for a cached chunk.
 */
function onDemand<Props extends object>(
	load: () => Promise<{ default: ComponentType<Props> }>,
): (props: Props) => JSX.Element {
	const Page = lazy(load);
	return function OnDemand(props: Props): JSX.Element {
		return (
			<Suspense fallback={null}>
				{/* biome-ignore lint/suspicious/noExplicitAny: Props only ties load to the component */}
				<Page {...(props as any)} />
			</Suspense>
		);
	};
}

export const AutomationsPage = onDemand(async () => ({
	default: (await import("./automations")).AutomationsPage,
}));
export const BudgetPage = onDemand(async () => ({
	default: (await import("./budget")).BudgetPage,
}));
export const SetupPage = onDemand(async () => ({
	default: (await import("./setup-page")).SetupPage,
}));
export const StatsPage = onDemand(async () => ({
	default: (await import("./stats")).StatsPage,
}));
export const EvalsPage = onDemand(async () => ({
	default: (await import("./evals-page")).EvalsPage,
}));
export const WorkersPage = onDemand(async () => ({
	default: (await import("./workers")).WorkersPage,
}));

export const BackgroundPane = onDemand(async () => ({
	default: (await import("./background-pane")).BackgroundPane,
}));

export const Todos = onDemand(async () => ({
	default: (await import("./todos")).Todos,
}));
export const Lightbox = onDemand(async () => ({
	default: (await import("./lightbox-dialog")).Lightbox,
}));
export const Annotate = onDemand(async () => ({
	default: (await import("./annotate-dialog")).Annotate,
}));

export const AutoPickPage = onDemand(async () => ({
	default: (await import("./auto-pick-page")).AutoPickPage,
}));

export const NotesPage = onDemand(async () => ({
	default: (await import("./notes-page")).NotesPage,
}));
