/** Indicates a user input issue (bad flags, unknown site, missing tag, ...).
 *  Surface a clean message and exit 1 instead of dumping a stack trace. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}
