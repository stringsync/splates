import type { AreaProgress } from "@splates/server/setup";
import { FlagIcon, Loader2Icon, PlusIcon } from "lucide-react";
import {
	type JSX,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useSyncExternalStore,
} from "react";
import { Checkbox } from "#web/components/ui/checkbox.tsx";
import { useWide } from "./app-nav";
import { ShortcutSettings, useShortcutLabel } from "./hooks/use-shortcut";
import type { Move } from "./page-address";
import type { Page } from "./page-route";
import { SetupContext } from "./setup-state";
import { TopBar } from "./top-bar";

/** The page a desktop opens to: a way to begin, and the setup areas still left to do. */
export function WelcomePage({
	onSetup,
	onConversation,
}: {
	/** Opens the Setup page on an area, or the index for null. */
	onSetup: (area: string | null, step?: string | null, how?: Move) => void;
	/** Opens a new conversation. */
	onConversation: () => void;
}): JSX.Element {
	const { progress, cached, reading } = useContext(SetupContext);
	// What the device last read stands in until this read answers, so the page is never empty.
	const shown = progress ?? cached;
	const left = recommended(shown?.areas ?? []);
	const newKeys = useShortcutLabel("shortcuts.new");
	return (
		<section
			aria-label="welcome"
			className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-10 pb-10"
		>
			<TopBar title="Welcome" />
			<header className="flex items-center gap-6 px-3 pt-6">
				<PlateIcon className="size-16 shrink-0 rounded-2xl" />
				<div className="flex flex-col gap-1">
					<h1 className="font-normal text-3xl tracking-tight">
						Welcome back to splates
					</h1>
					<p className="text-lg text-muted-foreground italic">
						Many agents, one trunk
					</p>
				</div>
			</header>
			<WelcomeGroup heading="Get started">
				<WelcomeRow
					label="New conversation"
					icon={<PlusIcon aria-hidden />}
					keys={newKeys}
					onClick={onConversation}
				/>
			</WelcomeGroup>
			{(shown === null || left.length > 0) && (
				<WelcomeGroup heading="Suggested next" loading={reading}>
					{shown === null && <WelcomeSkeleton />}
					{left.map((area) => (
						<WelcomeRow
							key={area.id}
							label={`Set up ${area.title}`}
							hint={area.purpose}
							icon={<FlagIcon aria-hidden className="text-warning" />}
							onClick={() => onSetup(area.id)}
						/>
					))}
				</WelcomeGroup>
			)}
			<ShowOnStartup />
		</section>
	);
}

/** A titled list of rows, ruled across like a Zed welcome section; a spinner beside the title while it loads. */
function WelcomeGroup({
	heading,
	loading = false,
	children,
}: {
	heading: string;
	loading?: boolean;
	children: ReactNode;
}): JSX.Element {
	return (
		<div className="flex flex-col gap-2">
			<h2 className="flex items-center gap-3 px-3 font-mono text-muted-foreground text-xs uppercase">
				{heading}
				{loading && (
					<Loader2Icon
						role="img"
						aria-label="checking setup"
						className="size-3.5 animate-spin"
					/>
				)}
				<span aria-hidden className="h-px flex-1 bg-border" />
			</h2>
			<ul className="flex flex-col gap-0.5">{children}</ul>
		</div>
	);
}

/** One action: an icon, what it does, and its shortcut when it has one. */
function WelcomeRow({
	label,
	hint,
	icon,
	keys,
	onClick,
}: {
	label: string;
	hint?: string;
	icon: ReactNode;
	keys?: string | null;
	onClick: () => void;
}): JSX.Element {
	return (
		<li>
			<button
				type="button"
				aria-label={label}
				className="flex w-full cursor-pointer items-center gap-4 rounded-lg px-3 py-3 text-left outline-none hover:bg-muted/60 focus-visible:bg-muted/60"
				onClick={onClick}
			>
				<span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-5">
					{icon}
				</span>
				<span className="flex-1 text-lg">{label}</span>
				{hint && (
					<span className="hidden truncate text-muted-foreground text-sm sm:block">
						{hint}
					</span>
				)}
				{keys && (
					<kbd className="font-mono text-muted-foreground text-sm">{keys}</kbd>
				)}
			</button>
		</li>
	);
}

/** Placeholder rows while the first read of setup, with nothing kept from an earlier one, is out. */
function WelcomeSkeleton(): JSX.Element {
	return (
		<>
			{[0, 1].map((at) => (
				<li key={at} aria-hidden className="flex items-center gap-4 px-3 py-3">
					<span className="size-5 animate-pulse rounded bg-muted" />
					<span className="h-5 w-48 animate-pulse rounded bg-muted" />
				</li>
			))}
		</>
	);
}

/** The app's icon, the plate the installed app and its tab wear. */
function PlateIcon({ className }: { className?: string }): JSX.Element {
	return <img src="/icon-192.png" alt="" className={className} />;
}

/** How many areas the page suggests at a time. */
const SUGGESTED = 4;

/** The project journeys the page always suggests while they are left, however many other areas are. */
const JOURNEYS = ["ships", "evals"];

/**
 * The few areas worth doing next: those not done, or with something to put
 * right, the ones that are not optional first, else in the index's order,
 * then each project journey still left, which the cap never drops.
 */
function recommended(areas: readonly AreaProgress[]): AreaProgress[] {
	const left = areas.filter(
		(area) =>
			!area.complete || area.steps.some((step) => step.warning !== null),
	);
	const required = left.filter((area) => !area.optional);
	const first = [...required, ...left.filter((area) => area.optional)].slice(
		0,
		SUGGESTED,
	);
	const journeys = left.filter(
		(area) => JOURNEYS.includes(area.id) && !first.includes(area),
	);
	return [...first, ...journeys];
}

/** The checkbox at the foot of the page that turns its opening the app off and on. */
function ShowOnStartup(): JSX.Element {
	const settings = useContext(ShortcutSettings);
	const shown = useSyncExternalStore(
		(changed) => settings?.events.on("changed", changed) ?? (() => {}),
		() => settings?.get("startup.welcome") ?? true,
	);
	return (
		<div className="flex w-fit items-center gap-2 px-3 text-muted-foreground text-sm">
			<Checkbox
				id="welcome-startup"
				checked={shown}
				onCheckedChange={(checked) =>
					void settings?.set("startup.welcome", checked)
				}
			/>
			<label htmlFor="welcome-startup" className="cursor-pointer">
				Show welcome page on startup
			</label>
		</div>
	);
}

/**
 * Sends a desktop's open to the Welcome page, unless the setting that turns it
 * off is off or the address already names a page. A phone never lands on it.
 */
export function WelcomeLanding({
	go,
}: {
	go: (page: Page, conversation?: string | null, how?: Move) => void;
}): null {
	const wide = useWide();
	const settings = useContext(ShortcutSettings);
	const entry = useRef(location.hash === "");
	useEffect(() => {
		if (wide && entry.current && settings?.get("startup.welcome") !== false) {
			go("welcome", null, "replace");
		}
		entry.current = false;
	}, [wide, go, settings]);
	return null;
}
