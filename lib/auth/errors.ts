export class AuthError extends Error {
  readonly status = 401;

  constructor(message = "Sign in required") {
    super(message);
    this.name = "AuthError";
  }
}
