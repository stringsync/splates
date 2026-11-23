import {
	ChartColumnIcon,
	FlaskConicalIcon,
	GaugeIcon,
	KanbanIcon,
	KeyRoundIcon,
	ListChecksIcon,
	type LucideIcon,
	MessageSquareIcon,
	RadioIcon,
	ServerCogIcon,
	ShipIcon,
	SparklesIcon,
	VideoIcon,
	ZapIcon,
} from "lucide-react";
import type { Page } from "./page-route";

/** Names the visual color area a page belongs to. */
export type PageAreaId =
	| "boards"
	| "creds"
	| "auto-pick"
	| "rigs"
	| "stats"
	| "ships"
	| "signals"
	| "rec"
	| "evals"
	| "billing"
	| "setup"
	| "welcome"
	| "conversations";

/** Describes a page's color area, icon, summary, scope pill, and header sizing. */
export interface PageArea {
	/** Area color identifier for the page. */
	area: PageAreaId;
	/** Icon shown in the page header. */
	Icon: LucideIcon;
	/** Plain-language summary of what the page is for. */
	description: string;
	/** Scope label shown beside the title on full headers, or null to omit. */
	scope: "project" | "everywhere" | null;
	/** Whether the page uses the compact workspace header band. */
	compact: boolean;
	/** Max-width class matching the page content column on desktop. */
	columnClass: string;
}

/** Per-page area metadata used by the integrated header band and sidebar tint. */
export const PAGE_AREAS: Record<Page, PageArea> = {
	boards: {
		area: "boards",
		Icon: KanbanIcon,
		description:
			"Browse boards, organize lanes, and switch between project backlogs.",
		scope: "project",
		compact: false,
		columnClass: "max-w-3xl",
	},
	todos: {
		area: "boards",
		Icon: KanbanIcon,
		description:
			"Organize lanes, block dependencies, and queue tasks for agents.",
		scope: null,
		compact: true,
		columnClass: "",
	},
	tasks: {
		area: "boards",
		Icon: KanbanIcon,
		description:
			"Live execution order for queued work and running agents across this project.",
		scope: null,
		compact: true,
		columnClass: "",
	},
	creds: {
		area: "creds",
		Icon: KeyRoundIcon,
		description:
			"API keys and tokens kept in this device’s keychain; values never leave local storage.",
		scope: "project",
		compact: false,
		columnClass: "max-w-3xl",
	},
	"auto-pick": {
		area: "auto-pick",
		Icon: ZapIcon,
		description:
			"Route tasks to the right agent lineup automatically by kind and difficulty.",
		scope: "project",
		compact: false,
		columnClass: "max-w-5xl",
	},
	rigs: {
		area: "rigs",
		Icon: ServerCogIcon,
		description:
			"Start and monitor declared dev servers on main or isolated task worktrees.",
		scope: "project",
		compact: false,
		columnClass: "max-w-2xl",
	},
	stats: {
		area: "stats",
		Icon: ChartColumnIcon,
		description:
			"Track task cost, turnaround time, and completion rates across models.",
		scope: "everywhere",
		compact: false,
		columnClass: "max-w-3xl",
	},
	ships: {
		area: "ships",
		Icon: ShipIcon,
		description:
			"Pick release targets, check what is unshipped, and watch deploys step by step.",
		scope: "everywhere",
		compact: false,
		columnClass: "max-w-2xl",
	},
	signals: {
		area: "signals",
		Icon: RadioIcon,
		description:
			"Named events and poll scripts that wake waiting agents and unblock queued tasks.",
		scope: "everywhere",
		compact: false,
		columnClass: "max-w-5xl",
	},
	rec: {
		area: "rec",
		Icon: VideoIcon,
		description:
			"Record narrated browser sessions with console, network, and server logs for agents.",
		scope: "everywhere",
		compact: false,
		columnClass: "max-w-2xl",
	},
	evals: {
		area: "evals",
		Icon: FlaskConicalIcon,
		description:
			"Benchmark skill scenarios across agents, compare pass rates, and inspect graded failures.",
		scope: "everywhere",
		compact: false,
		columnClass: "max-w-2xl",
	},
	billing: {
		area: "billing",
		Icon: GaugeIcon,
		description:
			"Monitor token spend, plan limits, and local check budgets across providers.",
		scope: "everywhere",
		compact: false,
		columnClass: "max-w-3xl",
	},
	setup: {
		area: "setup",
		Icon: ListChecksIcon,
		description:
			"Guided checklists to configure projects, ships, evals, and credentials.",
		scope: "everywhere",
		compact: false,
		columnClass: "max-w-3xl",
	},
	welcome: {
		area: "welcome",
		Icon: SparklesIcon,
		description:
			"Many agents, one trunk: start a conversation or finish setting up your workspace.",
		scope: "everywhere",
		compact: false,
		columnClass: "max-w-2xl",
	},
	conversations: {
		area: "conversations",
		Icon: MessageSquareIcon,
		description:
			"Direct threads with agents running in isolated task worktrees.",
		scope: null,
		compact: true,
		columnClass: "",
	},
};

/** Returns the area identity and header layout for `page`. */
export function pageArea(page: Page): PageArea {
	return PAGE_AREAS[page];
}
