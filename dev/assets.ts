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

/** The page this package ships. Serve each field's contents as-is. */
export const assets: Assets = { shell, script, styles };
