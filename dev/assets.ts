import script from "./build/main.txt" with { type: "text" };
import shell from "./build/shell.txt" with { type: "text" };
import styles from "./build/styles.txt" with { type: "text" };

/** The three files the browser asks for, as the server hands them over. */
export interface Assets {
	/** The page, which asks for the other two. */
	shell: string;
	/** The React app, bundled for the browser. */
	script: string;
	/** The stylesheet, with Tailwind already compiled. */
	styles: string;
}

/**
 * The page this package ships, built by `build.ts` and imported here as text so
 * it travels inside the bundle a release publishes. Serving it costs a string
 * lookup, and nothing is read off disk: a published package has no `dev/`
 * directory to read from, and the CLI's own dependencies stay clear of React
 * and Tailwind because neither is needed once the page is built.
 */
export const assets: Assets = { shell, script, styles };
