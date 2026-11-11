import type { Author, GitIdentity } from "./git-identity";

/** The author of a machine nobody named one for: it names none, so commits are signed `splates`. */
export class NoopAuthor implements Author {
	async author(): Promise<GitIdentity | null> {
		return null;
	}
}
