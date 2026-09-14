import { z } from "zod";

/**
 * An email that identifies a user account, normalized before anything looks
 * it up.
 *
 * better-auth lowercases the address when it stores a user, but our own
 * lookups (`verifyCredentials`, `issueSession`, the duplicate check) query by
 * the address as typed. So "Rahim@Gmail.com" registered an agency, then got a
 * 401 because nobody by that exact spelling existed — and could not log in
 * with the address they had just typed either. Trimming and lowercasing at the
 * validation edge makes every later lookup agree with what was stored.
 *
 * Trim and lowercase run before the format check, so pasted whitespace does
 * not fail validation.
 */
export const loginEmail = (message = "A valid email is required") =>
  z.string(message).trim().toLowerCase().pipe(z.email(message));
