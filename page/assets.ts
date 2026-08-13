import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Scanner } from "@tailwindcss/oxide";
import type { Fs } from "@webappwiz/sys";
import { compile } from "tailwindcss";
import type { Bundler } from "./bundler/bundler";

const here = import.meta.dirname;

/**
 * The three files the browser asks for, built here rather than by an HTML
 * import.
 *
 * ponytail: the import route bundles the page in one line, but it hands the
 * stylesheet to the bundler's CSS pipeline, which inlines Tailwind and leaves
 * `@tailwind utilities` in the output. Compiling Tailwind properly needs
 * `bun-plugin-tailwind`, which is configured in `bunfig.toml`, which is read
 * from the current directory: `arbor dev` runs inside whatever repo the user is
 * in, so that file is theirs and never ours. Building the two assets by hand
 * travels with the package instead of asking every caller to configure it.
 */
export class Assets {
	constructor(
		private readonly fs: Fs,
		private readonly bundler: Bundler,
	) {}

	/** The page itself, exactly as the file on disk has it. */
	shell(): Promise<string> {
		return this.fs.read(`${here}/index.html`);
	}

	/** The React app, bundled for the browser. */
	script(): Promise<string> {
		return this.bundler.bundle(`${here}/main.tsx`);
	}

	/** The stylesheet, with Tailwind compiled. */
	async styles(): Promise<string> {
		const compiler = await compile(await this.fs.read(`${here}/styles.css`), {
			base: here,
			loadStylesheet: async (id: string, base: string) => {
				// Tailwind asks for its own entry by bare name, then for the parts of it
				// by relative path. Only the bare name needs module resolution; the
				// rest are paths off a base that is already inside tailwind's package.
				const path =
					id === "tailwindcss"
						? fileURLToPath(import.meta.resolve("tailwindcss/index.css"))
						: resolve(base, id);
				return {
					path,
					base: dirname(path),
					content: await this.fs.read(path),
				};
			},
		});
		// The `@source` lines in styles.css say which files to read class names out
		// of. Tailwind emits only the utilities it finds there.
		const scanner = new Scanner({ sources: compiler.sources });
		return compiler.build(scanner.scan());
	}
}
