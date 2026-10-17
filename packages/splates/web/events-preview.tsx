import { MoonIcon, SunIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import type { Settings } from "./settings";
import { SplatesEvent } from "./splates-event";
import { type FixtureItem, fixtureThread } from "./splates-event-fixtures";

/** The address that opens the preview in place of the app. */
export const EVENTS_PREVIEW = "#events-preview";

/**
 * Splates's events in a thread of fixture turns, for judging their look before
 * the conversation draws real ones: each kind between the person's and the
 * agent's turns, as wide as a thread (48rem), with a switch between light
 * and dark.
 */
export function EventsPreview({
	settings,
}: {
	settings: Settings;
}): JSX.Element {
	const [now] = useState(() => Date.now());
	const [dark, setDark] = useState(() =>
		document.documentElement.classList.contains("dark"),
	);
	const thread = fixtureThread(now);
	return (
		<div className="@container min-h-dvh bg-background text-foreground">
			<div className="mx-auto flex w-full max-w-3xl flex-col px-4 pt-4 pb-14">
				<header className="mb-6 flex items-center justify-between px-2">
					<h1 className="font-medium text-sm">Splates events</h1>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={dark ? "Light" : "Dark"}
						onClick={() => {
							void settings.set("appearance.theme", dark ? "light" : "dark");
							setDark(!dark);
						}}
					>
						{dark ? <SunIcon /> : <MoonIcon />}
					</Button>
				</header>
				<div className="[&>*+*]:mt-6">
					{thread.map((item, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
						<Item key={index} item={item} />
					))}
				</div>
			</div>
		</div>
	);
}

function Item({ item }: { item: FixtureItem }): JSX.Element {
	switch (item.kind) {
		case "user":
			return (
				<div className="wrap-break-word rounded-lg border border-foreground/15 bg-muted px-4 py-2.5 max-sm:px-3 max-sm:py-1.5 max-sm:text-sm">
					{item.text}
				</div>
			);
		case "agent":
			return <p className="px-2 leading-relaxed">{item.text}</p>;
		case "event":
			return <SplatesEvent event={item.event} />;
	}
}
