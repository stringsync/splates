import { useReactive } from "@webappwiz/react";
import { type JSX, useContext } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import type { Move } from "./page-address";
import type { Settings } from "./settings";
import { SetupIndex } from "./setup-form";
import { SetupContext } from "./setup-state";

/** Shows the setup areas when the app opens. Closing it stops it showing in this browser; turn on "Setup welcome" in Settings to see it again. */
export function WelcomeDialog({
	settings,
	onSetup,
}: {
	settings: Settings;
	/** Opens the Setup page on an area, or the index for null. */
	onSetup: (area: string | null, step?: string | null, how?: Move) => void;
}): JSX.Element | null {
	const { progress } = useContext(SetupContext);
	const show = useReactive(
		settings,
		(settings) => settings.get("welcome.show"),
		["changed"],
	);
	if (progress === null) {
		return null;
	}
	const close = () => void settings.set("welcome.show", false);
	return (
		<Dialog open={show} onOpenChange={(open) => !open && close()}>
			<DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
				<DialogTitle>Welcome to splates</DialogTitle>
				<DialogDescription>
					Set up what you want to use. Each area stands alone, and the ones
					marked optional can wait.
				</DialogDescription>
				<SetupIndex
					areas={progress.areas}
					onSelect={(id) => {
						close();
						onSetup(id);
					}}
				/>
				<div className="flex justify-end gap-2">
					<Button
						variant="outline"
						onClick={() => {
							close();
							onSetup(null);
						}}
					>
						Open Setup
					</Button>
					<Button onClick={close}>Got it</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
