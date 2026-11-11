export type VisitorRole = "user" | `operator_${string}`;

export class OperatorVerificationError extends Error {
  constructor() { super("Operator verification unavailable"); this.name = "OperatorVerificationError"; }
}

/** A cookie is only a claim; the service API must confirm it for each message. */
export async function resolveVisitorRole(token: unknown, resolve: (token: string) => Promise<number | null>): Promise<VisitorRole> {
  if (typeof token !== "string" || token.length !== 32 || !/^[a-f0-9]{32}$/i.test(token)) return "user";
  const normalized = token.toLowerCase();
  try {
    const operatorId = await resolve(normalized);
    return typeof operatorId === "number" && Number.isSafeInteger(operatorId) && operatorId > 0
      ? `operator_${operatorId}` : "user";
  } catch {
    // Do not expose the token, API URL, or upstream response in diagnostics.
    throw new OperatorVerificationError();
  }
}
