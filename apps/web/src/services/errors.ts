/** A problem with what the user typed, safe to show them as-is. */
export class UserInputError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'UserInputError';
  }
}

/** The row doesn't exist, or is deleted and so can no longer be changed. */
export class NotFoundError extends Error {
  constructor(what: string, id: string) {
    super(`${what} ${id} not found`);
    this.name = 'NotFoundError';
  }
}
