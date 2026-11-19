import { fail } from "../exit";
import type { Project, ProjectWatch } from "../server/shared";
import { body } from "../server/shared";
import { PROVIDERS, type Provider, SCOPES, type Scope } from "./stores";

/** The routes behind the Creds page. A value only comes in: none answers with one. */
export class CredRoutes {
	readonly #project: Project;
	readonly #watch: ProjectWatch;

	readonly #raise: (name: string, payload: unknown) => Promise<void>;

	// `raise` announces cred.saved/<NAME> or cred.dismissed/<NAME>, with the
	// name and scope as payload, never the value.
	constructor(
		project: Project,
		watch: ProjectWatch,
		raise: (name: string, payload: unknown) => Promise<void> = async () => {},
	) {
		this.#project = project;
		this.#watch = watch;
		this.#raise = raise;
	}

	/** What each store keeps, by name, and what the stores are called. */
	readonly listCreds = async (): Promise<Response> => {
		const { creds } = this.#project;
		return Response.json({
			kept: await creds.kept(),
			providers: creds.providers,
			labels: Object.fromEntries(
				creds.providers.map((provider) => [
					provider,
					Object.fromEntries(
						SCOPES.map((scope) => [scope, creds.label(scope, provider)]),
					),
				]),
			),
		});
	};

	// Fills its request when one is open, in the scope it asked for.
	readonly saveCred = async (request: Request): Promise<Response> => {
		const name = nameIn(request);
		const { value, scope, provider } = await body(request);
		if (typeof value !== "string") {
			fail("usage", `no value given for ${name}: nothing saved`, { name });
		}
		const kept = await this.#project.journal.record("creds save", null, () =>
			this.#project.creds.save(name, value, {
				scope: scope === undefined ? undefined : scopeIn(scope),
				provider: provider === undefined ? undefined : providerIn(provider),
			}),
		);
		this.#watch.tick();
		await this.#raise(`cred.saved/${name}`, { name, scope: kept });
		return Response.json({ name, scope: kept });
	};

	readonly removeCred = async (request: Request): Promise<Response> => {
		const name = nameIn(request);
		const params = new URL(request.url).searchParams;
		const scope = scopeIn(params.get("scope"));
		const provider = providerIn(params.get("provider") ?? "system");
		await this.#project.journal.record("creds remove", null, () =>
			this.#project.creds.remove(name, scope, provider),
		);
		this.#watch.tick();
		return Response.json({ name, scope, provider });
	};

	readonly dismissCred = async (request: Request): Promise<Response> => {
		const name = nameIn(request);
		await this.#project.journal.record("creds dismiss", null, () =>
			this.#project.creds.dismiss(name),
		);
		this.#watch.tick();
		await this.#raise(`cred.dismissed/${name}`, { name });
		return Response.json({ name });
	};
}

/** The cred `/api/creds/:name` names. */
function nameIn(request: Request): string {
	return decodeURIComponent(new URL(request.url).pathname.split("/")[3] ?? "");
}

function scopeIn(scope: unknown): Scope {
	if (!SCOPES.includes(scope as Scope)) {
		fail("usage", `scope is one of ${SCOPES.join(", ")}: not ${scope}`, {
			scope: String(scope),
		});
	}
	return scope as Scope;
}

function providerIn(provider: unknown): Provider {
	if (!PROVIDERS.includes(provider as Provider)) {
		fail(
			"usage",
			`provider is one of ${PROVIDERS.join(", ")}: not ${provider}`,
			{
				provider: String(provider),
			},
		);
	}
	return provider as Provider;
}
