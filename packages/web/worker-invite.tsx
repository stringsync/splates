import { CopyIcon, PlusIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { inviteWorker } from "./api";
import { copiedLabel, useCopy } from "./card";
import { Refusal, useRefusals } from "./refusal";

/**
 * Mints a join token, and shows the command that joins another machine
 * with it, to copy there.
 */
export function JoinToken(): JSX.Element {
	const [invite, setInvite] = useState<{
		token: string;
		expiresAt: number;
	} | null>(null);
	const [minting, setMinting] = useState(false);
	const { refusals, refuse } = useRefusals<null>();
	const { copied, copy } = useCopy();
	const command =
		invite === null
			? null
			: `splates worker run --coordinator ${location.origin} --join ${invite.token}`;
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
			{command !== null && invite !== null && (
				<section aria-label="join command" className="flex flex-col gap-1">
					<div className="flex items-center gap-2">
						<code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border bg-muted px-2 py-1 font-mono text-[12px]">
							{command}
						</code>
						<Button
							variant="ghost"
							size="sm"
							aria-label="Copy the join command"
							onClick={() => copy(command)}
						>
							<CopyIcon />
							{copiedLabel(copied, "Copy")}
						</Button>
					</div>
					<span className="text-muted-foreground text-xs">
						Run it on the machine to join, by{" "}
						{new Date(invite.expiresAt).toLocaleTimeString()}.
					</span>
				</section>
			)}
			<Refusal refusal={refusals.get(null)} />
		</div>
	);
}
