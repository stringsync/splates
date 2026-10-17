import type { Ps } from "webappwiz/system";

/**
 * Who pays for what the agents use. `claude -p` reports a cost at API prices
 * whoever pays: an API key is billed it, while a Claude plan counts the
 * tokens against its usage limits instead.
 */
export class Payer {
	private constructor(
		/** Names it in a sentence: "your API key", "your Claude Max plan". */
		private readonly name: string | null,
		private readonly billed: boolean,
	) {}

	/** Who `claude -p` charges, run as the evals run it. */
	static async of(ps: Ps): Promise<Payer> {
		// `claude -p` takes a key in the environment over a login.
		if (ps.env("ANTHROPIC_API_KEY")) {
			return new Payer("your API key", true);
		}
		const { exitCode, stdout } = await ps.spawnCapture(
			["claude", "auth", "status"],
			{ stdin: "" },
		);
		const status = (exitCode === 0 ? parse(stdout) : null) ?? {};
		if (status.authMethod === "claude.ai") {
			const plan =
				typeof status.subscriptionType === "string"
					? ` ${status.subscriptionType[0]?.toUpperCase()}${status.subscriptionType.slice(1)}`
					: "";
			return new Payer(`your Claude${plan} plan's usage limits`, false);
		}
		return new Payer(null, true);
	}

	/** The question asked before a batch, for a yes. */
	ask(usd: number, tokens: number): string {
		const amount = `about ${this.amount(usd, tokens)}`;
		if (this.name === null) {
			return `Spend ${amount}?`;
		}
		return this.billed
			? `Spend ${amount} on ${this.name}?`
			: `Use ${amount} of ${this.name}?`;
	}

	/** What a batch used, once it is done. */
	used(usd: number, tokens: number): string {
		const amount = this.amount(usd, tokens);
		if (this.name === null) {
			return `spent ${amount}`;
		}
		return this.billed
			? `spent ${amount} on ${this.name}`
			: `used ${amount} of ${this.name}`;
	}

	private amount(usd: number, tokens: number): string {
		const counted = tokens > 0 ? ` (${count(tokens)} tokens)` : "";
		return `$${usd.toFixed(2)} at API prices${counted}`;
	}
}

interface AuthStatus {
	authMethod?: unknown;
	subscriptionType?: unknown;
}

function parse(text: string): AuthStatus | null {
	try {
		return JSON.parse(text) as AuthStatus;
	} catch {
		return null;
	}
}

/** A token count as a person reads it: 2.1M, 840k. */
function count(tokens: number): string {
	return tokens >= 1e6
		? `${(tokens / 1e6).toFixed(1)}M`
		: `${Math.round(tokens / 1e3)}k`;
}
