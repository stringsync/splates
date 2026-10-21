import type { SecretStores } from "../creds";
import { API_TOKEN, TUNNEL_TOKEN } from "../tunnel/saved";

/** The cred a project's deploy key is kept as, in its store. */
export const DEPLOY_KEY = "SPLATES_DEPLOY_KEY";

/**
 * What the box still needs set in its Parameter Store, which its Pulumi
 * stack puts there: the device's tunnel token and Cloudflare API token, which mints worker
 * service tokens, and the deploy key of each
 * project whose clone is at `roots`. Each is named for the user to set
 * or the stack to make.
 */
export async function neededCreds(
	stores: SecretStores,
	roots: string[],
): Promise<string[]> {
	const missing: string[] = [];
	if ((await stores.device.get(TUNNEL_TOKEN)) === undefined) {
		missing.push(`/splates/device/${TUNNEL_TOKEN}`);
	}
	if ((await stores.device.get(API_TOKEN)) === undefined) {
		missing.push(`/splates/device/${API_TOKEN}`);
	}
	for (const root of roots) {
		const store = await stores.project(root);
		if ((await store.get(DEPLOY_KEY)) === undefined) {
			missing.push(`${DEPLOY_KEY} in ${store.label}`);
		}
	}
	return missing;
}

/** The deploy key of the project whose clone is at `root`; undefined for none. */
export async function deployKey(
	stores: SecretStores,
	root: string,
): Promise<string | undefined> {
	return (await stores.project(root)).get(DEPLOY_KEY);
}
