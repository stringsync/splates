/**
 * What checks a value read back is the type it was stored as, throwing when
 * it is not: a zod schema is one.
 */
export interface Schema<T> {
	parse(raw: unknown): T;
}
