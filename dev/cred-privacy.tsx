import { ShieldCheckIcon } from "lucide-react";
import type { JSX } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#dev/components/ui/dialog.tsx";

/** What the privacy dialog says, one point a paragraph. */
const PRIVACY: { title: string; body: string }[] = [
	{
		title: "The agent never sees it",
		body: "Save sends it from this page to arbor dev, which hands it to the store. The agent only learns that it was saved.",
	},
	{
		title: "It is in no conversation or log",
		body: "What you paste never becomes a message, so no conversation's history holds it. arbor's logs and its record of requests name the cred, never its value, and no page or command shows it again.",
	},
	{
		title: "It is never saved in plain text",
		body: "It goes into the system's store: the macOS Keychain, Windows Credential Manager, or a Linux secret service, each encrypted. With none to reach, arbor refuses to save rather than write a file.",
	},
	{
		title: "Only code reads it",
		body: "Code reads it in-process through webappwiz/creds, never through an environment variable, a command's arguments or a file. Code that reads it could still print it, as with any secret.",
	},
];

/**
 * A small line under a paste field saying the value stays private, then
 * Learn more, which opens a dialog on how.
 */
export function CredPrivacy(): JSX.Element {
	return (
		<Dialog>
			{/* Inline, so on a phone it wraps as a sentence, the icon on its first line. */}
			<p className="text-muted-foreground text-xs leading-relaxed">
				<ShieldCheckIcon className="mr-1 inline size-3.5 align-[-0.2em]" />
				Private: the agent never sees it, and it is kept encrypted.{" "}
				<DialogTrigger
					render={
						<button
							type="button"
							className="cursor-pointer rounded underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
						/>
					}
				>
					Learn more
				</DialogTrigger>
			</p>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<ShieldCheckIcon className="size-4" />
						How creds stay private
					</DialogTitle>
					<DialogDescription>
						What you paste goes straight to your system's store, and nowhere
						else.
					</DialogDescription>
				</DialogHeader>
				<dl className="flex flex-col gap-3 text-sm">
					{PRIVACY.map((each) => (
						<div key={each.title} className="flex flex-col gap-0.5">
							<dt className="font-medium">{each.title}</dt>
							<dd className="text-muted-foreground leading-relaxed">
								{each.body}
							</dd>
						</div>
					))}
				</dl>
			</DialogContent>
		</Dialog>
	);
}
