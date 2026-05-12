/**
 * Tests for the admin OOC corrections in-memory store (Ticket 1).
 */

import { beforeEach, describe, expect, test } from "bun:test";

import {
  _resetAdminCorrectionsForTest,
  type AdminCorrection,
  type AdminTarget,
  addAdminCorrection,
  clearAdminCorrections,
  formatAdminCorrectionsForPrompt,
  getAdminCorrections,
  isCorrectionVisible,
  MAX_AGE_TURNS,
} from "./admin-corrections.js";

function make(target: AdminTarget, overrides: Partial<AdminCorrection> = {}): AdminCorrection {
  return {
    target,
    message: "default message",
    remember: false,
    issuedAt: new Date().toISOString(),
    issuedAtTurn: 0,
    issuedBy: "admin-id",
    ...overrides,
  };
}

beforeEach(() => {
  _resetAdminCorrectionsForTest();
});

describe("admin-corrections store", () => {
  test("add then get returns inserted entries in order", () => {
    addAdminCorrection("g1", make({ kind: "dm" }, { message: "a" }));
    addAdminCorrection("g1", make({ kind: "dm" }, { message: "b" }));
    const list = getAdminCorrections("g1");
    expect(list.map((e) => e.message)).toEqual(["a", "b"]);
  });

  test("FIFO buffer is capped at 10 entries", () => {
    for (let i = 0; i < 15; i++) {
      addAdminCorrection("g1", make({ kind: "dm" }, { message: `m${i}` }));
    }
    const list = getAdminCorrections("g1");
    expect(list.length).toBe(10);
    expect(list[0].message).toBe("m5");
    expect(list[9].message).toBe("m14");
  });

  test("clearAdminCorrections empties the buffer for that game only", () => {
    addAdminCorrection("g1", make({ kind: "dm" }));
    addAdminCorrection("g2", make({ kind: "dm" }));
    clearAdminCorrections("g1");
    expect(getAdminCorrections("g1")).toEqual([]);
    expect(getAdminCorrections("g2").length).toBe(1);
  });
});

describe("isCorrectionVisible", () => {
  test('"all" target is visible to both DM and any agent', () => {
    const c = make({ kind: "all" }, { issuedAtTurn: 5 });
    expect(isCorrectionVisible(c, { kind: "dm" }, 5)).toBe(true);
    expect(isCorrectionVisible(c, { kind: "agent", name: "Grimbold" }, 5)).toBe(true);
  });

  test('"dm" target is visible to DM only', () => {
    const c = make({ kind: "dm" }, { issuedAtTurn: 5 });
    expect(isCorrectionVisible(c, { kind: "dm" }, 5)).toBe(true);
    expect(isCorrectionVisible(c, { kind: "agent", name: "Grimbold" }, 5)).toBe(false);
  });

  test('"agent" target is visible only to the matching agent (case-insensitive)', () => {
    const c = make({ kind: "agent", name: "Grimbold Ironforge" }, { issuedAtTurn: 5 });
    expect(isCorrectionVisible(c, { kind: "agent", name: "GRIMBOLD ironforge" }, 5)).toBe(true);
    expect(isCorrectionVisible(c, { kind: "agent", name: "Nyx Namfoodle" }, 5)).toBe(false);
    expect(isCorrectionVisible(c, { kind: "dm" }, 5)).toBe(false);
  });

  test('"human" target is not surfaced to DM or agents', () => {
    const c = make({ kind: "human", playerId: "u1" }, { issuedAtTurn: 5 });
    expect(isCorrectionVisible(c, { kind: "dm" }, 5)).toBe(false);
    expect(isCorrectionVisible(c, { kind: "agent", name: "Grimbold" }, 5)).toBe(false);
  });

  test("stale entries are filtered out (issuedAtTurn + MAX_AGE_TURNS <= current)", () => {
    const c = make({ kind: "all" }, { issuedAtTurn: 0 });
    expect(isCorrectionVisible(c, { kind: "dm" }, MAX_AGE_TURNS - 1)).toBe(true);
    expect(isCorrectionVisible(c, { kind: "dm" }, MAX_AGE_TURNS)).toBe(false);
    expect(isCorrectionVisible(c, { kind: "dm" }, MAX_AGE_TURNS + 5)).toBe(false);
  });
});

describe("formatAdminCorrectionsForPrompt", () => {
  test("returns null when no corrections exist", () => {
    expect(formatAdminCorrectionsForPrompt("empty-game", { kind: "dm" }, 1)).toBeNull();
  });

  test("renders only entries visible to the recipient", () => {
    addAdminCorrection("g1", make({ kind: "dm" }, { message: "DM only", issuedAtTurn: 1 }));
    addAdminCorrection(
      "g1",
      make({ kind: "agent", name: "Grimbold" }, { message: "Grimbold only", issuedAtTurn: 1 }),
    );
    addAdminCorrection("g1", make({ kind: "all" }, { message: "Everyone", issuedAtTurn: 1 }));

    const dmPrompt = formatAdminCorrectionsForPrompt("g1", { kind: "dm" }, 1);
    expect(dmPrompt).toContain("DM only");
    expect(dmPrompt).toContain("Everyone");
    expect(dmPrompt).not.toContain("Grimbold only");

    const grimboldPrompt = formatAdminCorrectionsForPrompt(
      "g1",
      { kind: "agent", name: "Grimbold" },
      1,
    );
    expect(grimboldPrompt).toContain("Grimbold only");
    expect(grimboldPrompt).toContain("Everyone");
    expect(grimboldPrompt).not.toContain("DM only");

    const nyxPrompt = formatAdminCorrectionsForPrompt(
      "g1",
      { kind: "agent", name: "Nyx Namfoodle" },
      1,
    );
    expect(nyxPrompt).toContain("Everyone");
    expect(nyxPrompt).not.toContain("DM only");
    expect(nyxPrompt).not.toContain("Grimbold only");
  });

  test("returns null once all entries have aged out", () => {
    addAdminCorrection("g1", make({ kind: "all" }, { message: "old", issuedAtTurn: 0 }));
    expect(formatAdminCorrectionsForPrompt("g1", { kind: "dm" }, 0)).toContain("old");
    expect(formatAdminCorrectionsForPrompt("g1", { kind: "dm" }, 100)).toBeNull();
  });

  test("renders block under high-salience header", () => {
    addAdminCorrection(
      "g1",
      make({ kind: "dm" }, { message: "Brannock is female", issuedAtTurn: 1 }),
    );
    const prompt = formatAdminCorrectionsForPrompt("g1", { kind: "dm" }, 1);
    expect(prompt).toContain("⚠️ Admin Correction");
    expect(prompt).toContain("READ FIRST");
    expect(prompt).toContain("Brannock is female");
  });
});
