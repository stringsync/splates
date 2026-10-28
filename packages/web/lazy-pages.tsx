import {
	Component,
	type ComponentType,
	type JSX,
	lazy,
	type ReactNode,
	Suspense,
	useState,
} from "react";
import { aborts } from "webappwiz/abort";
import { expiring, WAITS } from "./api";
import { ReadFailed, StillWaiting } from "./countdown";

/**
 * A page that loads when it is first opened rather than with the app. A slow
 * load counts down as any read does, and one that fails says so with Try
 * again rather than leaving the page blank.
 */
export function onDemand<Props extends object>(
	load: () => Promise<{ default: ComponentType<Props> }>,
): (props: Props) => JSX.Element {
	let Loaded: ComponentType<Props> | null = null;
	const loaded = () =>
		lazy(async () => {
			const timeout = expiring(WAITS.answer);
			try {
				const module = await aborts.race(timeout.signal, load());
				Loaded = module.default;
				return module;
			} catch (error) {
				reloadForNewBuild(error);
				throw error;
			} finally {
				timeout.dispose();
			}
		});
	return function OnDemand(props: Props): JSX.Element {
		// A rejected chunk stays rejected in its `lazy`: Try again makes another.
		const [{ Page, attempt, cached }, setTry] = useState(() => ({
			Page: Loaded ?? loaded(),
			attempt: 0,
			cached: Loaded !== null,
		}));
		if (cached) {
			/* biome-ignore lint/suspicious/noExplicitAny: Props only ties load to the component */
			return <Page {...(props as any)} />;
		}
		return (
			<ChunkFailed
				key={attempt}
				onRetry={() =>
					setTry({ Page: loaded(), attempt: attempt + 1, cached: false })
				}
			>
				<Suspense fallback={<StillWaiting />}>
					{/* biome-ignore lint/suspicious/noExplicitAny: Props only ties load to the component */}
					<Page {...(props as any)} />
				</Suspense>
			</ChunkFailed>
		);
	};
}

const RELOADED_AT = "chunk-reloaded-at";

/**
 * A tab left open across a server restart holds a script that names chunks
 * only the old build had, so its import fails for good. Reloading fetches the
 * new script; at most once a minute, so a chunk that is truly gone shows the
 * error rather than looping.
 */
function reloadForNewBuild(
	error: unknown,
	reload: () => void = () => location.reload(),
): void {
	if (!(error instanceof TypeError)) {
		return;
	}
	if (!/dynamically imported module/i.test(error.message)) {
		return;
	}
	const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
	if (Date.now() - last < 60_000) {
		return;
	}
	sessionStorage.setItem(RELOADED_AT, String(Date.now()));
	reload();
}

/** What `onDemand` shows in place of a chunk that failed or never came. */
class ChunkFailed extends Component<
	{ children: ReactNode; onRetry: () => void },
	{ failed: string | null }
> {
	override state: { failed: string | null } = { failed: null };

	static getDerivedStateFromError(error: unknown): { failed: string } {
		return {
			failed:
				error instanceof DOMException && error.name === "TimeoutError"
					? `no answer in ${WAITS.answer.ms / 1000}s`
					: error instanceof Error
						? error.message
						: String(error),
		};
	}

	override render(): ReactNode {
		const { failed } = this.state;
		return failed === null ? (
			this.props.children
		) : (
			<ReadFailed
				error={`Couldn't load this part of the page: ${failed}. Reload the page if it keeps failing.`}
				onRetry={this.props.onRetry}
			/>
		);
	}
}

export const AutomationsPage = onDemand(async () => ({
	default: (await import("./automations")).AutomationsPage,
}));
export const BillingPage = onDemand(async () => ({
	default: (await import("./billing")).BillingPage,
}));
export const SetupPage = onDemand(async () => ({
	default: (await import("./setup-page")).SetupPage,
}));
export const StatsPage = onDemand(async () => ({
	default: (await import("./stats")).StatsPage,
}));
export const ShipsPage = onDemand(async () => ({
	default: (await import("./ships-page")).ShipsPage,
}));
export const EvalsPage = onDemand(async () => ({
	default: (await import("./evals-page")).EvalsPage,
}));

export const BackgroundPane = onDemand(async () => ({
	default: (await import("./background-pane")).BackgroundPane,
}));

export const MergeOutputPane = onDemand(async () => ({
	default: (await import("./background-pane")).MergeOutputPane,
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
