import { createLucideIcon } from "lucide-react";

/**
 * A plate between a fork and a knife, the 🍽️ of the app's icon, drawn on
 * lucide's grid so it sits among lucide's icons. Lucide has no plate.
 */
export const PlateIcon = createLucideIcon({
	name: "plate",
	node: [
		["circle", { cx: "12", cy: "12", r: "5.5", key: "plate" }],
		["circle", { cx: "12", cy: "12", r: "2.5", key: "well" }],
		["path", { d: "M1.5 3v4.5a1.5 1.5 0 0 0 3 0V3", key: "tines" }],
		["path", { d: "M3 9v12", key: "fork" }],
		["path", { d: "M22.5 21V3a3 3 0 0 0-3 3v6h3", key: "knife" }],
	],
});
