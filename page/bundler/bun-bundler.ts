import type { Bundler } from "./bundler";

/** Bundles with `Bun.build`, which is the only thing in here that knows Bun. */
export class BunBundler implements Bundler {
	async bundle(entrypoint: string): Promise<string> {
		const built = await Bun.build({
			entrypoints: [entrypoint],
			target: "browser",
		});
		const [output] = built.outputs;
		if (output === undefined) {
			throw new Error(built.logs.map(String).join("\n"));
		}
		return output.text();
	}
}
