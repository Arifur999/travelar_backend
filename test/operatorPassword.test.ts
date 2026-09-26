import { describe, expect, it } from "vitest";
import { operatorPasswordProblem } from "../src/config/env.js";

/**
 * The one account that can reach every tenant.
 *
 * SUPER_ADMIN belongs to no agency and manages all of them. `.env.example`
 * shipped a working password for it — committed, public, and accepted by a
 * validator that asked only for eight characters — so anyone who booted the
 * repo as published had a known password on the account that owns every set
 * of books on the platform.
 */
describe("the operator password production refuses", () => {
  it("refuses the value that was committed in .env.example", () => {
    const problem = operatorPasswordProblem("Admin@12345", "production");

    expect(problem).not.toBeNull();
    expect(problem).toMatch(/example values/i);
  });

  it("refuses the value the tests boot with", () => {
    // Harmless against a localhost database, fatal on the live platform.
    expect(operatorPasswordProblem("Operator@12345", "production")).not.toBeNull();
  });

  it("refuses the placeholder .env.example now ships", () => {
    expect(operatorPasswordProblem("change-me-before-first-boot", "production")).not.toBeNull();
  });

  it("refuses a short password, and says how to make one", () => {
    const problem = operatorPasswordProblem("Admin@3827", "production");

    expect(problem).toMatch(/16 characters/);
    expect(problem).toMatch(/openssl rand -hex 16/);
  });

  it("accepts what the deploy script generates", () => {
    // bootstrap.sh writes Tv- plus 20 hex characters.
    expect(operatorPasswordProblem("Tv-3f9a2c7b1e4d6a8c0b2e", "production")).toBeNull();
  });

  it("leaves development and test alone", () => {
    // A weak password on a laptop guards a database on localhost. Refusing it
    // would be theatre, and would break the documented way to start the repo.
    expect(operatorPasswordProblem("Admin@12345", "development")).toBeNull();
    expect(operatorPasswordProblem("Operator@12345", "test")).toBeNull();
  });
});
