import { ColumnsIcon, GitBranchIcon } from "lucide-react";
import {
	createContext,
	type JSX,
	type ReactNode,
	type RefObject,
	useCallback,
	useContext,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { cn } from "#dev/lib/utils.ts";
import type { Ending, Report, Start } from "../asked";
import { CardShell, toCardTop } from "./card-shell";
import { Markdown } from "./markdown";

/**
 * What a conversation's thread holds that says which task it is on, or which
 * lanes: its Added and Started cards, each by its element, the reports that
 * end a task, by its name, or the lanes, as null, and the viewport they
 * scroll in.
 */
interface Registry {
	starts: Map<HTMLElement, Start>;
	ends: Map<HTMLElement, string | null>;
	viewport: RefObject<HTMLElement | null> | null;
	changed: () => void;
}

const RegistryContext = createContext<Registry | null>(null);

/**
 * The endings after which a task is over for the conversation, unlike an
 * escalation: a task handed off goes on in another.
 */
const OVER: ReadonlySet<Ending> = new Set(["merged", "removed", "handed"]);

/**
 * Holds what a conversation's thread says about its tasks, for the
 * `CurrentTask` card beside it, which `version` has measure again as the
 * thread's cards come and go.
 */
export function TaskRegistry({
	children,
}: {
	children: (version: number) => ReactNode;
}): JSX.Element {
	const [version, setVersion] = useState(0);
	const changed = useCallback(() => setVersion((at) => at + 1), []);
	const registry = useRef<Registry>({
		starts: new Map(),
		ends: new Map(),
		viewport: null,
		changed,
	}).current;
	return (
		<RegistryContext.Provider value={registry}>
			{children(version)}
		</RegistryContext.Provider>
	);
}

/** Gives the thread's viewport to the registry; nothing outside one. */
export function useTaskViewport(viewport: RefObject<HTMLElement | null>): void {
	const registry = useContext(RegistryContext);
	useLayoutEffect(() => {
		if (registry === null) {
			return;
		}
		registry.viewport = viewport;
		registry.changed();
		return () => {
			registry.viewport = null;
		};
	}, [registry, viewport]);
}

/** Gives an Added or Started card's element to the registry, as its ref. */
export function useStartCard(
	start: Start,
): (element: HTMLElement | null) => void {
	return useRegistered((registry) => registry.starts, start);
}

/**
 * Gives a report card's element to the registry, if it ends its task, or the
 * lanes the conversation orchestrates.
 */
export function useEndCard(
	report: Report,
): ((element: HTMLElement | null) => void) | undefined {
	const ref = useRegistered(
		(registry) => registry.ends,
		"lanes" in report ? null : report.task,
	);
	return report.ending === "finished" || OVER.has(report.ending)
		? ref
		: undefined;
}

function useRegistered<T>(
	map: (registry: Registry) => Map<HTMLElement, T>,
	value: T,
): (element: HTMLElement | null) => void {
	const registry = useContext(RegistryContext);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `map` only picks a field
	return useCallback(
		(element: HTMLElement | null) => {
			if (registry === null || element === null) {
				return;
			}
			map(registry).set(element, value);
			registry.changed();
			return () => {
				map(registry).delete(element);
				registry.changed();
			};
		},
		[registry, value],
	);
}

/**
 * The task the thread is on at the point it is scrolled to, or the lanes it
 * orchestrates, as a card in the panel beside it: the last Added or Started
 * card scrolled up out of sight, while no report that its task merged or was
 * removed, or that its lanes finished, has come up since. It fades in as
 * the card goes behind the person's message stuck atop its turn, and out as
 * the card comes back into view or the task ends, so it never says what the
 * thread on screen already does.
 */
export function CurrentTask({
	version,
}: {
	version: number;
}): JSX.Element | null {
	const registry = useContext(RegistryContext);
	// The card whose task shows, and the last one shown, kept while it fades.
	const [current, setCurrent] = useState<HTMLElement | null>(null);
	const [last, setLast] = useState<HTMLElement | null>(null);
	const now = useRef<HTMLElement | null>(null);
	now.current = current;

	// biome-ignore lint/correctness/useExhaustiveDependencies: `version` counts the cards' changes
	useLayoutEffect(() => {
		const scroller = registry?.viewport?.current ?? null;
		if (registry === null || scroller === null) {
			return;
		}
		let frame = 0;
		const measure = () => {
			frame = 0;
			const next = currentCard(registry, scroller);
			if (next !== now.current) {
				setCurrent(next);
				if (next !== null) {
					setLast(next);
				}
			}
		};
		const schedule = () => {
			if (frame === 0) {
				frame = requestAnimationFrame(measure);
			}
		};
		measure();
		scroller.addEventListener("scroll", schedule, { passive: true });
		const resized = new ResizeObserver(schedule);
		resized.observe(scroller);
		return () => {
			cancelAnimationFrame(frame);
			scroller.removeEventListener("scroll", schedule);
			resized.disconnect();
		};
	}, [registry, version]);

	const card = current ?? last;
	const start = card === null ? undefined : registry?.starts.get(card);
	if (card === null || start === undefined) {
		return null;
	}
	const named = "lanes" in start ? start.lanes.join(", ") : start.task;
	return (
		<div
			aria-hidden={current === null}
			inert={current === null}
			className={cn(
				"[&>[data-card]]:my-0",
				"transition-[opacity,translate] duration-300 ease-out motion-reduce:transition-none",
				current === null ? "-translate-y-1 opacity-0" : "opacity-100",
			)}
		>
			<CardShell
				label={`current ${named}`}
				// Its name as the title, plain: the header line above the thread
				// already offers the task's details.
				Icon={"lanes" in start ? ColumnsIcon : GitBranchIcon}
				title={named}
				ringed={false}
			>
				{start.goal !== "" && (
					// Back to where the task was added; its chip opens the task.
					<button
						type="button"
						title={
							"lanes" in start
								? "Show where they were started"
								: "Show where it was added"
						}
						onClick={() => toCardTop(card, "smooth")}
						className="block w-full text-start transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
					>
						{/* Unlinked, as links cannot sit in a button. */}
						<Markdown
							text={start.goal}
							unlinked
							className="line-clamp-[10] px-3 py-3 text-sm leading-relaxed [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
						/>
					</button>
				)}
			</CardShell>
		</div>
	);
}

/**
 * The Added or Started card of the task or lanes the thread is on where
 * `scroller` stands: the lowest one gone out of sight above, unless a report
 * that its task is over, or its lanes finished, has since come into view.
 */
function currentCard(
	registry: Registry,
	scroller: HTMLElement,
): HTMLElement | null {
	const { top, bottom } = scroller.getBoundingClientRect();
	let found: HTMLElement | null = null;
	let lowest = Number.NEGATIVE_INFINITY;
	for (const card of registry.starts.keys()) {
		const at = card.getBoundingClientRect().top;
		if (card.isConnected && gone(card, top) && at > lowest) {
			found = card;
			lowest = at;
		}
	}
	if (found === null) {
		return null;
	}
	const start = registry.starts.get(found);
	// Lanes end on a finished report, registered as null.
	const task = start === undefined || "lanes" in start ? null : start.task;
	for (const [end, ended] of registry.ends) {
		const at = end.getBoundingClientRect().top;
		if (end.isConnected && ended === task && at > lowest && at < bottom) {
			return null;
		}
	}
	return found;
}

/**
 * Whether `card` has gone out of sight above: its foot behind the person's
 * message stuck atop its turn, or above the thread's top.
 */
function gone(card: HTMLElement, top: number): boolean {
	const stuck = card.closest('[data-slot="aui_turn"]')?.firstElementChild;
	const over =
		stuck instanceof HTMLElement && stuck.dataset.role === "user"
			? Math.max(top, stuck.getBoundingClientRect().bottom)
			: top;
	// A card with no box, not laid out, is nowhere to have gone from.
	return card.offsetHeight > 0 && card.getBoundingClientRect().bottom <= over;
}
