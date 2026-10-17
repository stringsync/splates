import { createContext } from "react";
import { EDITORS, type Editor, ZED as ZED_EDITOR } from "../editors";

/** An editor a file the page names can open in, through the link it handles. */
export interface Opener {
	id: string;
	/** What the Settings dialog calls it. */
	label: string;
	/** The link that opens `path` in it, at `line` when there is one. */
	url(path: string, line: number | null): string;
}

export const ZED = fileUrl(ZED_EDITOR);

/** Every editor a file can open in, in the order the Settings dialog offers them. */
export const OPENERS: readonly Opener[] = EDITORS.map((editor) =>
	editor === ZED_EDITOR ? ZED : fileUrl(editor),
);

/** The opener `id` names, or Zed for one the page no longer knows. */
export function openerOf(id: string): Opener {
	return OPENERS.find((opener) => opener.id === id) ?? ZED;
}

/** Where the person has files open, as the Settings dialog has it. */
export const OpenerContext = createContext<Opener>(ZED);

/** An editor that opens `scheme://file/<path>:<line>`, as Zed and VS Code's family do. */
function fileUrl({ id, label, scheme }: Editor): Opener {
	return {
		id,
		label,
		url: (path, line) =>
			`${scheme}://file${encodeURI(path)}${line === null ? "" : `:${line}`}`,
	};
}
