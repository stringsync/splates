/** The least time between two reloads to sign in, so a sign-in that does not take cannot loop. */
const RELOAD_GAP_MS = 60_000;
const RELOADED = "splates.signInReload";

/**
 * Cloudflare Access answers every address with a redirect to its login once
 * the person's sign-in lapses, which a `fetch` here cannot follow, so the
 * page's reads and streams all fail and it would say it cannot reach a server
 * that is up. This finds that out and reloads the page to sign in again.
 */
export class SignIn {
	constructor(
		private readonly store: Pick<Storage, "getItem" | "setItem"> = {
			// Looked up when used, as the page's tests load this without one.
			getItem: (key) => sessionStorage.getItem(key),
			setItem: (key, value) => sessionStorage.setItem(key, value),
		},
		private readonly reload: () => void = () => location.reload(),
		private readonly now: () => number = () => Date.now(),
		private readonly fetcher: (
			input: string,
			init: RequestInit,
		) => Promise<Pick<Response, "type">> = (input, init) => fetch(input, init),
	) {}

	/** Whether Access wants the person to sign in again. */
	async wanted(): Promise<boolean> {
		try {
			// The shell: a worker serves it from its cache only to a navigation.
			const response = await this.fetcher("/", {
				redirect: "manual",
				cache: "no-store",
				credentials: "include",
			});
			return response.type === "opaqueredirect";
		} catch {
			return false;
		}
	}

	/**
	 * Reloads the page, which Access sends to its login, when it wants a
	 * sign-in and the page did not reload for it a moment ago. Says whether it
	 * did.
	 */
	async reloadIfWanted(): Promise<boolean> {
		if (!(await this.wanted())) {
			return false;
		}
		const now = this.now();
		if (now - Number(this.store.getItem(RELOADED) ?? 0) < RELOAD_GAP_MS) {
			return false;
		}
		this.store.setItem(RELOADED, String(now));
		this.reload();
		return true;
	}
}

/** The page's own. */
export const SIGN_IN = new SignIn();
