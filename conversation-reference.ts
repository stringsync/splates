/** Whether a # reference names a conversation by its stable UUID. */
export function conversationReference(called: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
		called,
	);
}
