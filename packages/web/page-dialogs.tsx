import type { JSX } from "react";
import type { Move } from "./page-address";
import type { Settings } from "./settings";
import { SettingsDialog } from "./settings-dialog";
import { WelcomeDialog } from "./welcome-dialog";

/** The dialogs the page holds over whatever it shows: the welcome, then Settings. */
export function PageDialogs({
	settings,
	settingsOpen,
	onSettingsOpenChange,
	onSetup,
}: {
	settings: Settings;
	settingsOpen: boolean;
	onSettingsOpenChange: (open: boolean) => void;
	/** Opens the Setup page on an area, or the index for null. */
	onSetup: (area: string | null, step?: string | null, how?: Move) => void;
}): JSX.Element {
	return (
		<>
			<WelcomeDialog settings={settings} onSetup={onSetup} />
			<SettingsDialog
				settings={settings}
				open={settingsOpen}
				onOpenChange={onSettingsOpenChange}
			/>
		</>
	);
}
