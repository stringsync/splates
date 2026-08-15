import type { Bundler } from "./bundler";

/** Bundles with `Bun.build`, which is the only thing in here that knows Bun. */
export class BunBundler implements Bundler {
	async bundle(entrypoint: string): Promise<string> {
		const built = await Bun.build({
			entrypoints: [entrypoint],
			target: "browser",
			// Left to throw, a failure arrives as an AggregateError that says only
			// "Bundle failed": which import went missing is in the logs, and the
			// person reading the terminal needs that to know it is their install.
			throw: false,
		});
		const [output] = built.outputs;
		if (output === undefined) {
			throw new Error(built.logs.map(String).join("\n"));
		}
		return output.text();
	}
}
