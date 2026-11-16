import { Credentials, Environment, SystemSecretStore } from "core/creds";
import { Duration, sleep } from "core/time";

/** The cred a TypeSafe key is read from. Rec runs without it, on code signals alone. */
export const JEV_KEY_NAME = "TYPESAFE_API_KEY";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";
/** 429 and 529 are retried this many times, backing off. */
const RETRIES = 3;

export type Question =
	| { type: "noul"; instructions: string }
	| {
			type: "choice";
			instructions: string;
			criteria: Record<string, string>;
	  }
	| { type: "score"; instructions: string; criteria: string[] };

export type Answer =
	| { type: "noul"; noul: number }
	| {
			type: "choice";
			choice: string;
			confidence: number;
			probabilities: Record<string, number>;
	  }
	| {
			type: "score";
			score: number;
			confidence: number;
			probabilities: Record<string, number>;
	  };

/** The device's, project's or environment's TypeSafe key, or nothing when there is none. */
export async function optionalJevKey(): Promise<string | undefined> {
	const credentials = new Credentials([
		new Environment(),
		await SystemSecretStore.forProject(),
		SystemSecretStore.device(),
	]);
	try {
		return await credentials.require(JEV_KEY_NAME);
	} catch {
		return undefined;
	}
}

/** TypeSafe's System One API: one state, several typed questions, one answer each. */
export class Jev {
	constructor(
		private readonly key: string,
		private readonly transport: Transport = NETWORK,
	) {}

	async ask(
		state: unknown,
		questions: Record<string, Question>,
	): Promise<Record<string, Answer>> {
		const body = JSON.stringify({ model: MODEL, state, questions });
		for (let attempt = 0; ; attempt++) {
			const response = await this.transport.fetch(ENDPOINT, {
				method: "POST",
				headers: {
					authorization: `Bearer ${this.key}`,
					"content-type": "application/json",
				},
				body,
			});
			if (response.ok) {
				const parsed = (await response.json()) as {
					answers?: Record<string, Answer>;
				};
				return parsed.answers ?? {};
			}
			if (
				(response.status === 429 || response.status === 529) &&
				attempt < RETRIES
			) {
				await sleep(Duration.ms(500 * 2 ** attempt));
				continue;
			}
			throw new Error(
				`Jev answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
			);
		}
	}
}

/** Sends the API's requests. */
export interface Transport {
	fetch(url: string, init: RequestInit): Promise<Response>;
}

const NETWORK: Transport = { fetch: (url, init) => fetch(url, init) };
