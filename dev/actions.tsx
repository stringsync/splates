import { PanelRightCloseIcon, PanelRightIcon } from "lucide-react";
import {
	type JSX,
	type ReactNode,
	type RefObject,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "#dev/components/ui/dropdown-menu.tsx";
import { cn } from "#dev/lib/utils.ts";
import {
	ShortcutSettings,
	useShortcut,
	useShortcutLabel,
} from "./hooks/use-shortcut";

/** Something to do with a conversation, or a place in it to go to. */
export interface Action {
	label: string;
	icon: ReactNode;
	/** Beside the label, such as a task's +/- counts. */
	detail?: ReactNode;
	/** Null for a row that only says something, or one that opens `menu`. */
	run: (() => void) | null;
	/** The items of a menu the row opens in place of running anything. */
	menu?: ReactNode;
}

/**
 * The thread's width, in rem, that holds the widgets docked beside its
 * messages: the widgets take `WIDGETS_ROOM` at the right, and the messages
 * keep to the middle of what is left, with at least 44rem of it.
 */
const ROOMY_REM = 61;

/**
 * What the docked widgets take from the right of the thread: their 15rem, a
 * 1rem margin clear of its scrollbar, and a gap before the messages.
 */
export const WIDGETS_ROOM = "16.75rem";

/**
 * Whether a conversation's widgets show, and where: docked beside its
 * messages where `section` leaves room for them, as the setting keeps it
 * between visits, open to start with; elsewhere floating over the thread,
 * open only until dismissed. The shortcut and the header's button toggle
 * whichever applies.
 */
export function useWidgets(section: RefObject<HTMLElement | null>): {
	roomy: boolean;
	open: boolean;
	toggle: () => void;
	close: () => void;
} {
	const settings = useContext(ShortcutSettings);
	const docked = useSyncExternalStore(
		(changed) => settings?.events.on("changed", changed) ?? (() => {}),
		() => settings?.get("conversation.widgets") ?? true,
	);
	const [floating, setFloating] = useState(false);
	const [roomy, setRoomy] = useState(false);
	useLayoutEffect(() => {
		const element = section.current;
		if (element === null) {
			return;
		}
		const measure = () => {
			const rem = Number.parseFloat(
				getComputedStyle(document.documentElement).fontSize,
			);
			setRoomy(element.clientWidth >= ROOMY_REM * (rem || 16));
		};
		measure();
		const resized = new ResizeObserver(measure);
		resized.observe(element);
		return () => resized.disconnect();
	}, [section]);
	// Floating ones go once there is room to dock them, not to float up
	// again when it is gone.
	useEffect(() => {
		if (roomy) {
			setFloating(false);
		}
	}, [roomy]);
	const toggle = () => {
		if (roomy) {
			void settings?.set("conversation.widgets", !docked);
		} else {
			setFloating((was) => !was);
		}
	};
	useShortcut("shortcuts.widgets", toggle);
	const close = useCallback(() => setFloating(false), []);
	return { roomy, open: roomy ? docked : floating, toggle, close };
}

/** The one button in a conversation's header, showing or hiding its widgets. */
export function WidgetsButton({
	open,
	onToggle,
	busy,
}: {
	open: boolean;
	onToggle: () => void;
	/** Marks the button while a widget has something going, such as a command running. */
	busy?: boolean;
}): JSX.Element {
	const key = useShortcutLabel("shortcuts.widgets");
	const label = open ? "Hide widgets" : "Show widgets";
	return (
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label="Widgets"
			aria-expanded={open}
			title={key === null ? label : `${label} (${key})`}
			onClick={onToggle}
			data-widgets-toggle
			className="relative"
		>
			{open ? <PanelRightCloseIcon /> : <PanelRightIcon />}
			{busy && !open && (
				<span
					aria-hidden
					className="absolute top-0.5 right-0.5 size-1.5 animate-pulse rounded-full bg-success"
				/>
			)}
		</Button>
	);
}

/**
 * Everything to do with a conversation, as widgets, each a card of its own:
 * the actions, many of them opening the pane beside the page, then a menu of
 * the commands it left in the background below a rule, and cards such as the
 * systems its task touches. Docked at the thread's right where it is
 * `roomy`, its messages centered in the room left of them; elsewhere
 * floating, frosted, over the thread's top right, like the Control Center,
 * gone on Escape, a click outside, or an action run.
 */
export function Widgets({
	actions,
	background,
	children,
	roomy,
	open,
	onClose,
}: {
	actions: Action[];
	/** Below another rule: a menu of the commands the agent left, while any are. */
	background?: ReactNode;
	/** Cards stacked under the actions, such as the systems a task touches. */
	children?: ReactNode;
	roomy: boolean;
	open: boolean;
	onClose: () => void;
}): JSX.Element {
	const panel = useRef<HTMLElement>(null);
	const floating = !roomy;
	useEffect(() => {
		if (!floating || !open) {
			return;
		}
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onClose();
			}
		};
		// Not from the button, which toggles them itself, nor from a menu
		// one of them opened, which sits outside in a portal.
		const press = (event: PointerEvent) => {
			const target = event.target as Element;
			if (
				!panel.current?.contains(target) &&
				target.closest("[data-widgets-toggle], [data-slot$=content]") === null
			) {
				onClose();
			}
		};
		window.addEventListener("keydown", key);
		window.addEventListener("pointerdown", press);
		return () => {
			window.removeEventListener("keydown", key);
			window.removeEventListener("pointerdown", press);
		};
	}, [floating, open, onClose]);
	const run = (action: Action): Action =>
		action.run === null || !floating
			? action
			: {
					...action,
					run: () => {
						onClose();
						action.run?.();
					},
				};
	return (
		<section
			ref={panel}
			aria-label="widgets"
			inert={!open}
			className={cn(
				"[&_[data-card]]:my-0 [&_[data-card]]:rounded-2xl [&_[data-widget]]:rounded-2xl",
				roomy
					? [
							"absolute top-0 right-4 z-10 flex w-60 flex-col gap-3",
							!open && "hidden",
						]
					: [
							// Padded for the cards' shadows, which a scroller would cut
							// off, and clicked through there.
							"-top-2 -right-2 pointer-events-none absolute z-20 flex max-h-[calc(100%+0.5rem)] w-76 max-w-full flex-col gap-2.5 overflow-y-auto px-2 pt-2 pb-10 *:pointer-events-auto",
							"[&_[data-card]]:bg-background/80 [&_[data-card]]:shadow-xl [&_[data-card]]:backdrop-blur-xl [&_[data-widget]]:bg-background/80 [&_[data-widget]]:shadow-xl [&_[data-widget]]:backdrop-blur-xl",
							"origin-top-right transition-[opacity,scale,visibility] duration-200 ease-out motion-reduce:transition-none",
							open ? "scale-100 opacity-100" : "invisible scale-95 opacity-0",
						],
			)}
		>
			<nav
				aria-label="actions"
				data-widget
				className="flex flex-col divide-y overflow-hidden rounded-lg border bg-background"
			>
				{actions.length > 0 && (
					<div className="py-1">
						{actions.map((action) => (
							<ActionRow key={action.label} action={run(action)} />
						))}
					</div>
				)}
				{background}
			</nav>
			{children}
		</section>
	);
}

/** One action, or a row that only says something when it has nothing to run. */
function ActionRow({ action }: { action: Action }): JSX.Element {
	const row =
		"flex h-8 w-full items-center gap-2 px-3 text-left text-sm [&_svg]:size-4";
	const detail = action.detail && (
		<span className="text-muted-foreground">{action.detail}</span>
	);
	const button = cn(
		row,
		"transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none [&_svg]:text-muted-foreground",
	);
	if (action.menu !== undefined) {
		return (
			<DropdownMenu>
				<DropdownMenuTrigger
					render={<button type="button" className={button} />}
				>
					{action.icon}
					<span className="flex-1">{action.label}</span>
					{detail}
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-52">
					{action.menu}
				</DropdownMenuContent>
			</DropdownMenu>
		);
	}
	return action.run === null ? (
		<p className={cn(row, "text-muted-foreground")}>
			{action.icon}
			<span className="flex-1">{action.label}</span>
			{detail}
		</p>
	) : (
		<button type="button" onClick={action.run} className={button}>
			{action.icon}
			<span className="flex-1">{action.label}</span>
			{detail}
		</button>
	);
}
