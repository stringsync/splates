import { MoveUpRightIcon, SquareIcon } from "lucide-react";
import type { JSX } from "react";
import type { Tool } from "./annotation";

/** The annotator's drawing tools, in the order shown, each with its key. */
export const TOOLS: {
	tool: Tool;
	label: string;
	key: string;
	icon: JSX.Element;
}[] = [
	{ tool: "arrow", label: "Arrow", key: "a", icon: <MoveUpRightIcon /> },
	{ tool: "box", label: "Box", key: "b", icon: <SquareIcon /> },
];

/** A control on the dark around the image, in either theme. */
export const LIGHT = "text-white hover:bg-white/15 hover:text-white";
