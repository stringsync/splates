import { SquareIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { Button } from "./components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "./components/ui/dialog";

/** Stop, which asks to confirm first: it ends every step under way. */
export function StopRun({
	stopping,
	onStop,
}: {
	stopping: boolean;
	onStop: () => void;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button
				variant="outline"
				size="sm"
				className="shrink-0 rounded-full text-destructive"
				disabled={stopping}
				onClick={() => setOpen(true)}
			>
				<SquareIcon aria-hidden className="size-2.5 fill-current" />
				{stopping ? "Stopping…" : "Stop"}
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent showCloseButton={false}>
					<DialogHeader>
						<DialogTitle>Stop this ship?</DialogTitle>
						<DialogDescription>
							Every step under way is ended. What already shipped stays out.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose render={<Button variant="outline" />}>
							Keep going
						</DialogClose>
						<Button
							variant="destructive"
							onClick={() => {
								setOpen(false);
								onStop();
							}}
						>
							Stop ship
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

/** One target's Stop, which asks to confirm first: only its steps end. */
export function StopTarget({
	name,
	stopping,
	onStop,
}: {
	name: string;
	stopping: boolean;
	onStop: () => void;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button
				variant="outline"
				size="sm"
				className="shrink-0 rounded-full text-destructive"
				disabled={stopping}
				aria-label={`Stop ${name}`}
				onClick={() => setOpen(true)}
			>
				<SquareIcon aria-hidden className="size-2.5 fill-current" />
				{stopping ? "Stopping…" : "Stop"}
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent showCloseButton={false}>
					<DialogHeader>
						<DialogTitle>Stop {name}?</DialogTitle>
						<DialogDescription>
							Its steps under way are ended and the rest of the ship carries on.
							Targets that depend on it do not run.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose render={<Button variant="outline" />}>
							Keep going
						</DialogClose>
						<Button
							variant="destructive"
							onClick={() => {
								setOpen(false);
								onStop();
							}}
						>
							Stop {name}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
