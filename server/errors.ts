// An error that carries an HTTP status. The API answers it as {"error", "issues"?} with that status;
// the CLI prints the message and the issues and exits 1.
export class HttpError extends Error {
  readonly status: number;
  readonly issues: string[] | undefined;

  constructor(status: number, message: string, issues?: string[]) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.issues = issues;
  }
}

/** The message of any thrown value, with its cause appended (fetch keeps the real reason there). */
export function errorMessage(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = e.cause instanceof Error ? e.cause.message : undefined;
  return cause && cause !== e.message ? `${e.message} (${cause})` : e.message;
}
