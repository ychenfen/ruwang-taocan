import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("verifies correct password and rejects wrong password", () => {
    const h = hashPassword("P@ssw0rd-123");
    expect(verifyPassword("P@ssw0rd-123", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
  });

  it("hashes with salt (two hashes differ)", () => {
    const h1 = hashPassword("same");
    const h2 = hashPassword("same");
    expect(h1).not.toBe(h2);
    expect(verifyPassword("same", h1)).toBe(true);
    expect(verifyPassword("same", h2)).toBe(true);
  });
});

