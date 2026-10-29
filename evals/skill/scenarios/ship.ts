import type { Scenario } from "../scenario";

const aspect = "shipping";

export const scenarios: readonly Scenario[] = [
	{
		id: `${aspect}/ship-conversation`,
		aspect,
		requirement:
			"A message opening [SPLATES SHIP <run>] makes the agent the ship agent: it reads references/ship.md, shapes the plan only through `splates ship plan` commands, posts the `ship plan` card from `ship plan propose` and ends its turn for the person's Approve, and never runs `npm publish`, `npm login` or a task-adding command for the release.",
		initialized: true,
		message:
			"[SPLATES SHIP run-1]\n\nShip webappwiz: the log rotation fix is on main and unreleased.",
		checks: [],
		judge:
			"Did the agent read the ship reference, plan through `splates ship plan` commands (show, set, leave-out, note, propose), end its reply with the plan card unchanged, and neither publish to npm nor start the run itself?",
		limits: { turns: 12, minutes: 10 },
	},
];
