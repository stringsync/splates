import { dirname } from "node:path";
import { Scanner } from "@tailwindcss/oxide";
import { compile } from "tailwindcss";

const here = import.meta.dir;

/**
 * The three files the browser asks for, built here rather than by Bun's HTML
 * import.
 *
 * ponytail: the import route bundles the page in one line, but it hands the
 * stylesheet to Bun's CSS pipeline, which inlines Tailwind and leaves
 * `@tailwind utilities` in the output. Compiling Tailwind properly needs
 * `bun-plugin-tailwind`, which is configured in `bunfig.toml`, which Bun reads
 * from the current directory: `arbor dev` runs inside whatever repo the user is
 * in, so that file is theirs and never ours. Building the two assets by hand
 * travels with the package instead of asking every caller to configure it.
 */

/** The page itself, exactly as the file on disk has it. */
export function shell(): Promise<string> {
	return Bun.file(`${here}/index.html`).text();
}

/** The React app, bundled for the browser. */
export async function script(): Promise<string> {
	const built = await Bun.build({
		entrypoints: [`${here}/main.tsx`],
		target: "browser",
	});
	const [output] = built.outputs;
	if (output === undefined) {
		throw new Error(
			`could not build the dev page: ${built.logs.map(String).join("\n")}`,
		);
	}
	return output.text();
}

/** The stylesheet, with Tailwind compiled. */
export async function styles(): Promise<string> {
	const compiler = await compile(await Bun.file(`${here}/styles.css`).text(), {
		base: here,
		loadStylesheet: async (id: string, base: string) => {
			// Tailwind asks for its own entry by bare name, then for the parts of it
			// by relative path.
			const path = Bun.resolveSync(
				id === "tailwindcss" ? "tailwindcss/index.css" : id,
				base,
			);
			return {
				path,
				base: dirname(path),
				content: await Bun.file(path).text(),
			};
		},
	});
	// The `@source` lines in styles.css say which files to read class names out
	// of. Tailwind emits only the utilities it finds there.
	const scanner = new Scanner({ sources: compiler.sources });
	return compiler.build(scanner.scan());
}
