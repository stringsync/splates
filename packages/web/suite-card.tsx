import type { PermissionProposal } from "@stringsync/splates-server/plans";
import { FlaskConicalIcon, PlayIcon } from "lucide-react";
import { createContext, type JSX, useContext, useState } from "react";
import { ActionCard } from "./action-card";
import { ArchiveConversation } from "./archive-offer";

/**
 * The conversation a card is in, for a card that approves something its
 * agent asked for; null outside one.
 */
export const SuiteApproval = createContext<{
	conversation: string;
	approve: () => Promise<void>;
} | null>(null);

/**
 * An agent's ask to run the whole test suite outside a merge's gate, which
 * splates refuses it until the person approves. Approving lets the
 * conversation run it once and tells the agent to.
 */
export function SuiteCard({
	proposal,
}: {
	proposal: PermissionProposal;
}): JSX.Element {
	const approval = useContext(SuiteApproval);
	const [done, setDone] = useState(false);
	const conversation = approval?.conversation ?? "<conversation>";
	return (
		// The agent has its run still to do, so approving is no time to archive.
		<ArchiveConversation value={null}>
			<ActionCard
				label="run the test suite"
				Icon={FlaskConicalIcon}
				title={
					done
						? "Approved the whole test suite"
						: proposal.title === null
							? "Run the whole test suite"
							: `Run the whole test suite: ${proposal.title}`
				}
				body={proposal.body}
				action={{
					verb: "Approve",
					VerbIcon: PlayIcon,
					done: "Approved for one run",
					command: `splates dev approve-suite ${conversation}`,
					run: async () => {
						setDone(true);
						await (approval?.approve() ?? Promise.resolve()).catch(
							(error: unknown) => {
								setDone(false);
								throw error;
							},
						);
					},
					failed: "Not approved",
				}}
				done={done}
				gone={approval === null ? "Approve it from its conversation." : null}
				note="One run, outside the merge gate."
			/>
		</ArchiveConversation>
	);
}
