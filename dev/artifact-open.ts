import { conversationArtifact } from "./conversation-api";

/**
 * Opens `version` of the artifact `name` of conversation `conversation`, from
 * its row beside the thread or its chip in a line. Until the page has viewers
 * for them, that downloads it, under its name.
 */
export function openArtifact(
	conversation: string,
	name: string,
	version: number,
): void {
	const link = document.createElement("a");
	link.href = conversationArtifact(conversation, name, version);
	link.download = name;
	link.click();
}
