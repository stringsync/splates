import type { RegistryHttp } from "./registry";

/** Registry responses for live-version tests, without network access. */
export class LiveRegistryHttp implements RegistryHttp {
	readonly urls: string[] = [];
	async fetch(url: string): Promise<Response> {
		this.urls.push(url);
		return url.includes("core")
			? Response.json({ name: "@example/core", version: "1.2.2" })
			: new Response("missing", { status: 404 });
	}
}
