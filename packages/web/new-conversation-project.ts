/**
 * Where a conversation of another project opens: on that project's page,
 * which becomes the one shown everywhere, New included.
 */

import { NEW } from "./conversation-address";

/**
 * The address of the screen that starts a conversation in the project
 * `slug` names, `open` its place under `#conversations/`, as `new/codex`.
 * Show it with `NavigationContext`'s `show`, which draws that project's page
 * in place.
 */
export function newConversationUrl(slug: string, open: string = NEW): string {
	const url = new URL(location.href);
	url.searchParams.set("project", slug);
	url.hash = `#conversations/${open}`;
	return url.toString();
}
