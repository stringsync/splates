import { useReactive } from "@webappwiz/react";
import { type JSX, useContext } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { useWide } from "./app-nav";
import type { Move } from "./page-address";
import type { Settings } from "./settings";
import { SetupIndex } from "./setup-form";
import { SetupContext } from "./setup-state";

/** A welcome that lists each setup area, what it is for and how far along it is. */
export function WelcomeDialog({
	settings,
	onSetup,
}: {
	settings: Settings;
	/** Opens the Setup page on an area, or the index for null. */
	onSetup: (area: string | null, step?: string | null, how?: Move) => void;
}): JSX.Element | null {
	const { progress } = useContext(SetupContext);
	const wide = useWide();
	const show = useReactive(
		settings,
		(settings) => settings.get("welcome.show"),
		["changed"],
	);
	// Closing it turns "welcome.show" off for this browser; Settings turns it on.
	// A phone opens straight to the inbox, with nothing over it.
	if (progress === null || !wide) {
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
