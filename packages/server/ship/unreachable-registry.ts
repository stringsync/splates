import type { RegistryHttp } from "./registry";

/** A registry that rejects every read, for offline tests. */
export class UnreachableRegistry implements RegistryHttp {
	async fetch(): Promise<Response> {
		throw new Error("offline");
	}
}
