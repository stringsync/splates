import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Scanner } from "@tailwindcss/oxide";
import { compile } from "tailwindcss";

/**
 * Builds the `arbor dev` page: the React app as one script, and the stylesheet
 * with Tailwind compiled. `dev/assets.ts` imports both as text, so they end up
 * inside the bundle a release publishes and the server hands them straight to
 * the browser.
 *
 * This runs here rather than on the first page load of every `arbor dev`, which
 * is what keeps React and Tailwind out of the published dependencies: a person
 * installing the CLI has no use for a toolchain that already ran. It is also
 * the only place the compile can read our own configuration, since `arbor dev`
 * runs inside whatever repository the user is in.
 *
 * `bun run build` in this package, and `bun install` at the workspace root,
 * which is what puts the output there for a fresh checkout.
 */

const here = import.meta.dirname;
const out = `${here}/dev/build`;

/** The browser script, as one file with React and the page's modules in it. */
async function script(): Promise<string> {
	const built = await Bun.build({
		entrypoints: [`${here}/dev/main.tsx`],
		target: "browser",
		// Left to throw, a failure arrives as an AggregateError that says only
		// "Bundle failed": which import went missing is in the logs, and whoever
		// is reading the terminal needs that to know it is their install.
		throw: false,
	});
	const [output] = built.outputs;
	if (output === undefined) {
		throw new Error(built.logs.map(String).join("\n"));
	}
	return output.text();
}

/** The stylesheet, with only the utilities the page actually uses in it. */
async function styles(): Promise<string> {
	const base = `${here}/dev`;
	const compiler = await compile(await Bun.file(`${base}/styles.css`).text(), {
		base,
		loadStylesheet: async (id: string, from: string) => {
			// Tailwind asks for its own entry by bare name, then for the parts of it
			// by relative path. Only the bare name needs module resolution; the rest
			// are paths off a base that is already inside tailwind's package.
			const path =
				id === "tailwindcss"
					? fileURLToPath(import.meta.resolve("tailwindcss/index.css"))
					: resolve(from, id);
			return {
				path,
				base: dirname(path),
				content: await Bun.file(path).text(),
			};
		},
	});
	// The `@source` lines in styles.css say which files to read class names out
	// of. Tailwind emits only the utilities it finds there.
	return compiler.build(new Scanner({ sources: compiler.sources }).scan());
}

// All three as `.txt`: what they hold is a blob the server hands to a browser,
// and the extensions they were authored under mean something else to a
// compiler. `.js` would have tsc typecheck a bundle that already compiled, and
// Bun's own types read `.html` and `.css` imports as something other than text.
await Bun.write(
	`${out}/shell.txt`,
	await Bun.file(`${here}/dev/index.html`).text(),
);
await Bun.write(`${out}/main.txt`, await script());
await Bun.write(`${out}/styles.txt`, await styles());
