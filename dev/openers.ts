import { createContext } from "react";

/** An editor a file the page names can open in, through the link it handles. */
export interface Opener {
	id: string;
	/** What the Settings dialog calls it. */
	label: string;
	/** The link that opens `path` in it, at `line` when there is one. */
	url(path: string, line: number | null): string;
}

/** An editor that opens `scheme://file/<path>:<line>`, as Zed and VS Code's family do. */
function fileUrl(id: string, label: string, scheme: string): Opener {
	return {
		id,
		label,
		url: (path, line) =>
			`${scheme}://file${encodeURI(path)}${line === null ? "" : `:${line}`}`,
	};
}

export const ZED = fileUrl("zed", "Zed", "zed");

/** Every editor a file can open in, in the order the Settings dialog offers them. */
export const OPENERS = [
	ZED,
	fileUrl("vscode", "VS Code", "vscode"),
	fileUrl("cursor", "Cursor", "cursor"),
] as const satisfies readonly Opener[];

/** The opener `id` names, or Zed for one the page no longer knows. */
export function openerOf(id: string): Opener {
	return OPENERS.find((opener) => opener.id === id) ?? ZED;
}

/** Where the person has files open, as the Settings dialog has it. */
export const OpenerContext = createContext<Opener>(ZED);
