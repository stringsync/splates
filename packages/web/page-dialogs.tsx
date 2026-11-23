import type { JSX } from "react";
import type { Settings } from "./settings";
import { SettingsDialog } from "./settings-dialog";

/** The dialogs the page holds over whatever it shows: Settings. */
export function PageDialogs({
	settings,
	settingsOpen,
	onSettingsOpenChange,
	onWelcome,
	project,
}: {
	settings: Settings;
	settingsOpen: boolean;
	onSettingsOpenChange: (open: boolean) => void;
	/** Opens the Welcome page. */
	onWelcome: () => void;
	project?: string;
}): JSX.Element {
	return (
		<SettingsDialog
			settings={settings}
			open={settingsOpen}
			onOpenChange={onSettingsOpenChange}
			onWelcome={onWelcome}
			project={project}
		/>
	);
}
