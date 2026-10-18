import {
	joinCommand,
	windowsJoinCommand,
} from "@stringsync/splates-server/workers/browser";
import { CopyIcon, PlusIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { inviteWorker } from "./api";
import { copiedLabel, useCopy } from "./card";
import { Refusal, useRefusals } from "./refusal";

/**
 * Mints a join token, and shows the commands that join another machine
 * with it, to copy there: one for Linux or macOS, one for Windows, which
 * installs the coordinator's own build, `build`, in WSL2.
 */
export function JoinToken({ build }: { build: string }): JSX.Element {
	const [invite, setInvite] = useState<{
		token: string;
		expiresAt: number;
	} | null>(null);
	const [minting, setMinting] = useState(false);
	const { refusals, refuse } = useRefusals<null>();
	return (
		<div className="flex flex-col gap-2">
			<Button
				variant="outline"
				size="sm"
				className="w-fit"
				disabled={minting}
				onClick={() => {
					setMinting(true);
					inviteWorker()
						.then(setInvite, (caught) => refuse(null, "No join token", caught))
						.finally(() => setMinting(false));
				}}
			>
				<PlusIcon />
				{invite === null ? "Add a worker" : "Another token"}
			</Button>
			{invite !== null && (
				<>
					<JoinCommand
						label="join command"
						platform="Linux or macOS"
						command={joinCommand(location.origin, invite.token)}
					/>
					<JoinCommand
						label="windows join command"
						platform="Windows, in PowerShell as an administrator"
						command={windowsJoinCommand(location.origin, invite.token, build)}
					/>
					<span className="text-muted-foreground text-xs">
						Run one on the machine to join, by{" "}
						{new Date(invite.expiresAt).toLocaleTimeString()}.
					</span>
				</>
			)}
			<Refusal refusal={refusals.get(null)} />
		</div>
	);
}

/** One join command, with what it runs on and a button to copy it. */
function JoinCommand({
	label,
	platform,
	command,
}: {
	label: string;
	platform: string;
	command: string;
}): JSX.Element {
	const { copied, copy } = useCopy();
	return (
		<section aria-label={label} className="flex flex-col gap-1">
			<span className="text-muted-foreground text-xs">{platform}</span>
			<div className="flex items-center gap-2">
				<code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border bg-muted px-2 py-1 font-mono text-[12px]">
					{command}
				</code>
				<Button
					variant="ghost"
					size="sm"
					aria-label={`Copy the ${label}`}
					onClick={() => copy(command)}
				>
					<CopyIcon />
					{copiedLabel(copied, "Copy")}
				</Button>
			</div>
		</section>
	);
}
