import { type Fs, NodeFs } from "webappwiz/system";
import type { LaneRecord } from "./lanes";
import type { TodoState } from "./todo";
import type { Todos } from "./todos";

/**
 * A real batch of related todos, from sound2score, and the three lanes they
 * were run in: what the tests and a demo `arbor dev` load to see lanes at a
 * size that matters. An arrow is "merges before":
 *
 * ```
 * #187 → #191 → #177 → #186
 *                    → #189
 *                    → #208
 *                    → #196 → #184
 *                           → #197
 * independent: #198 #200 #201 #206 #207 #209 #211
 * ```
 *
 * Lane 1 is the chain. Lane 2 starts on independent work so its agent is busy
 * while lane 1 builds up to #177, then takes three of its forks. Lane 3 holds
 * independent todos that touch the same files, so their agents never fight
 * over rebases.
 */
export function sound2score({
	lanes = true,
}: {
	/** Put the todos in the lanes they ran in; false leaves every one in none. */
	lanes?: boolean;
} = {}): TodoState[] {
	const rows: [number, string, number[], number | null][] = [
		[187, "Store a license per account", [], 1],
		[191, "Check the license on every transcription", [187], 1],
		[177, "Gate score exports by license tier", [191], 1],
		[196, "Activate a license offline", [177], 1],
		[197, "Cache license checks for offline use", [196], 1],
		[184, "Let admins revoke a license", [196], 1],
		[200, "Upgrade the audio decoder", [], 2],
		[209, "Retry failed uploads", [], 2],
		[186, "Show the license tier on the account page", [177], 2],
		[208, "List license tiers on the pricing page", [177], 2],
		[189, "Email a receipt for each license bought", [177], 2],
		[207, "Split the score editor into panes", [], 3],
		[211, "Number the pages in the score editor", [], 3],
		[201, "Rename the export menu", [], 3],
		[206, "Add keyboard shortcuts to the score editor", [], 3],
		[198, "Detect tempo in swing rhythms", [], 3],
	];
	const now = Date.now();
	return rows.map(([id, subject, blockedBy, lane], i) => ({
		id,
		subject,
		text: DETAIL[id] ?? "",
		position: i + 1,
		from: null,
		createdAt: new Date(now - (rows.length - i) * 3_600_000).toISOString(),
		takenBy: null,
		files: [],
		blockedBy,
		lane: lanes ? lane : null,
	}));
}

/** The names the sound2score lanes were given, in board order. */
export const SOUND2SCORE_LANES: LaneRecord[] = [
	{ id: 1, name: "Licensing" },
	{ id: 2, name: "Audio, uploads and pricing" },
	{ id: 3, name: "Score editor" },
];

/**
 * Writes `states` to `todos` as they are, ids and all, and `lanes` as the
 * lanes there are; those the todos are in, by default, as `sound2score`
 * named them.
 */
export async function seed(
	todos: Todos,
	states: TodoState[],
	fs: Fs = new NodeFs(),
	lanes: LaneRecord[] = SOUND2SCORE_LANES.filter((record) =>
		states.some((state) => state.lane === record.id),
	),
): Promise<void> {
	await fs.mkdir(todos.dir);
	for (const state of states) {
		await todos.save(state);
	}
	await fs.write(
		`${todos.dir}/lanes`,
		`${JSON.stringify(lanes, null, "\t")}\n`,
	);
	// As if each lane had been made the usual way, so none is handed out again.
	const ids = [
		...states.map((state) => state.lane ?? 0),
		...lanes.map((record) => record.id),
	];
	await fs.write(`${todos.dir}/last-lane`, String(Math.max(0, ...ids)));
}

const DETAIL: Record<number, string> = {
	187: "A `licenses` table keyed by account, with the tier and when it runs out.\n\n- [ ] migration\n- [ ] model in `src/licensing/license.ts`",
	191: "Every request to `/transcribe` reads the license from #187 and refuses an expired one.",
	177: "Exports to PDF and MusicXML need the pro tier. The tiers come from #187.",
	196: "Sign the license so `sound2score` can check it with no network.",
	197: "Keep the last good check for a week, so a laptop on a plane still exports.",
	184: "An admin page action that revokes, and pushes the revocation to #196's offline copy.",
	186: "Next to the email on `/account`, with an upgrade link for the free tier.",
	208: "The pricing page reads tiers from the same table #177 gates on.",
	189: "Send it from the purchase webhook in `src/billing/webhook.ts`.",
	200: "The decoder in `src/audio/decode.ts` drops the last frame of some FLACs.",
	209: "Back off and retry a failed chunk three times before giving up.",
	207: "Notes on the left, the score on the right, resizable.",
	211: "Shown under each page, and in the PDF export.",
	201: "'Export' becomes 'Download', since nothing else is exported.",
	206: "Space plays, arrows step a beat, `[` and `]` step a bar.",
	198: "Swing eighths read as triplets today; see the fixtures in `test/audio/swing`.",
};
