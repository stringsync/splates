import type { ConversationState } from "@stringsync/splates-server/conversations";
import { FolderGit2Icon } from "lucide-react";
import { type JSX, useContext, useState } from "react";
import {
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
} from "#web/components/ui/dropdown-menu.tsx";
import { useProjects } from "./composer-triggers";
import { continueConversation } from "./conversation-api";
import { NavigationContext } from "./navigation";
import { newConversationUrl } from "./new-conversation-project";
import type { Refuse } from "./refusal";

/**
 * Choose a project to carry a General conversation on in, for work that
 * changes its repository: a new conversation there reads what was said
 * here, and its page opens on it.
 */
export function ContinueItems({
	conversation,
	refused,
}: {
	conversation: ConversationState;
	refused: Refuse;
}): JSX.Element {
	const projects = useProjects();
	const navigation = useContext(NavigationContext);
	const [going, setGoing] = useState<string | null>(null);
	const go = (slug: string): void => {
		setGoing(slug);
		continueConversation(conversation.id, slug)
			.then(({ project, id }) =>
				navigation.show(newConversationUrl(project, id)),
			)
			.catch((error: unknown) => refused("Not continued", error))
			.finally(() => setGoing(null));
	};
	return (
		<DropdownMenuGroup>
			<DropdownMenuLabel>Continue in project</DropdownMenuLabel>
			{projects === null ? (
				<DropdownMenuItem disabled>Loading…</DropdownMenuItem>
			) : projects.length === 0 ? (
				<DropdownMenuItem disabled>No projects yet</DropdownMenuItem>
			) : (
				projects.map(({ slug }) => (
					<DropdownMenuItem
						key={slug}
						disabled={going !== null}
						onClick={() => go(slug)}
					>
						<FolderGit2Icon />
						{going === slug ? `${slug}…` : slug}
					</DropdownMenuItem>
				))
			)}
		</DropdownMenuGroup>
	);
}
