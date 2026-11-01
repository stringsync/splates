import type { AreaProgress } from "@stringsync/splates-server/setup";
import { ArrowRightIcon } from "lucide-react";
import {
	type JSX,
	useContext,
	useEffect,
	useRef,
	useSyncExternalStore,
} from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Checkbox } from "#web/components/ui/checkbox.tsx";
import { useWide } from "./app-nav";
import { ShortcutSettings } from "./hooks/use-shortcut";
import type { Move } from "./page-address";
import type { Page } from "./page-route";
import { SetupIndex } from "./setup-form";
import { SetupContext } from "./setup-state";
import { TopBar } from "./top-bar";

/** The page a desktop opens to: each setup area, what it is for and how far along it is. */
export function WelcomePage({
	onSetup,
	onConversation,
}: {
	/** Opens the Setup page on an area, or the index for null. */
	onSetup: (area: string | null, step?: string | null, how?: Move) => void;
	/** Opens a new conversation. */
	onConversation: () => void;
}): JSX.Element {
	const { progress } = useContext(SetupContext);
	const left = recommended(progress?.areas ?? []);
	return (
		<section
			aria-label="welcome"
			className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-10 pb-10"
		>
			<TopBar title="Welcome" />
			<header className="flex flex-col gap-1 px-3 pt-6">
				<h1 className="font-semibold text-3xl tracking-tight">
					Welcome to splates
				</h1>
				<p className="text-lg text-muted-foreground">
					Many agents on one repository, each on its own branch.
				</p>
			</header>
			{(progress === null || left.length === 0) && (
				<NextSteps onSetup={onSetup} onConversation={onConversation} />
			)}
			{progress !== null && (
				<>
					<SetupIndex
						heading={left.length > 0 ? "Get started" : "You're all set"}
						areas={left}
						onSelect={(id) => onSetup(id)}
					/>
					<div className="mx-auto w-full max-w-2xl px-3">
						<Button
							variant="link"
							className="h-auto p-0"
							onClick={() => onSetup(null)}
						>
							All setup areas <ArrowRightIcon aria-hidden />
						</Button>
					</div>
				</>
			)}
			<ShowOnStartup />
		</section>
	);
}

/** What to do once no setup area is left to suggest, so the page is never a dead end. */
function NextSteps({
	onSetup,
	onConversation,
}: {
	onSetup: (area: string | null) => void;
	onConversation: () => void;
}): JSX.Element {
	return (
		<div className="flex flex-wrap gap-2 px-3">
			<Button onClick={onConversation}>Start a new conversation</Button>
			<Button variant="outline" onClick={() => onSetup("ships")}>
				Help me write a ship
			</Button>
			<Button variant="outline" onClick={() => onSetup("evals")}>
				Help me add an eval
			</Button>
		</div>
	);
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
			area.done < area.steps.length ||
			area.steps.some((step) => step.warning !== null),
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
