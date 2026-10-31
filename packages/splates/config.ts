/**
 * The types a repository's `splates.config.ts` imports, type-only, so the
 * file loads without splates installed:
 *
 * ```ts
 * import type { ConfigFile } from "@stringsync/splates/config";
 *
 * export default { postCheckout: "bun install" } satisfies ConfigFile;
 * ```
 */
export type {
	Config,
	ConfigFile,
	EvalsConfig,
} from "@stringsync/splates-server/config";
export type {
	TunnelProvider,
	TunnelRoute,
} from "@stringsync/splates-server/tunnel";
