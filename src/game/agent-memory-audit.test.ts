/**
 * Tests for the append-only agent memory audit log (Ticket 5.1).
 *
 * Note: this file mocks `../config.js` to redirect DATA_DIR into a temp dir
 * per Bun-test isolation conventions in this codebase.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const TEST_DATA_DIR = await mkdtemp(path.join(tmpdir(), "agent-audit-test-"));

mock.module("../config.js", () => ({
  config: { discordToken: "test", guildId: "test" },
  models: { dm: "test", agent: "test", orchestrator: "test" },
  DATA_DIR: TEST_DATA_DIR,
  AGENTS_DIR: "agents",
  AGENT_NOTES_DIR: "agent-notes",
  HISTORY_WINDOW: 8,
  COMPRESS_EVERY: 10,
  AGENT_DELAY_MS: 0,
  NARRATIVE_STYLE: "concise",
  STYLE_INSTRUCTIONS: {
    concise: { dm: "", agent: "" },
    standard: { dm: "", agent: "" },
    elaborate: { dm: "", agent: "" },
  },
}));

const { AUDIT_DIR_NAME, appendAuditEntry, formatAuditLine, getAuditDir, getAuditLogPath } =
  await import("./agent-memory-audit.js");

let counter = 0;
const gid = () => `audit-game-${counter++}`;

afterAll(async () => {
  await rm(TEST_DATA_DIR, { recursive: true, force: true });
});

describe("formatAuditLine (pure)", () => {
  test("renders one line with bullet separators", () => {
    const line = formatAuditLine(
      "2026-05-08T12:00:00.000Z",
      42,
      "Edit",
      "Edit on grimbold-ironforge.md: -[old] +[new]",
    );
    expect(line).toBe(
      "2026-05-08T12:00:00.000Z · turn=42 · Edit · Edit on grimbold-ironforge.md: -[old] +[new]",
    );
  });

  test("collapses embedded newlines so the line stays single-line", () => {
    const line = formatAuditLine("t", 1, "Edit", "old\nstring\n→\nnew\nstring");
    expect(line).not.toContain("\n");
    expect(line).toContain("old string → new string");
  });
});

describe("path helpers", () => {
  test("audit dir is `<DATA_DIR>/<id>/agent-notes/.audit`", () => {
    const g = gid();
    expect(getAuditDir(g)).toBe(path.join(TEST_DATA_DIR, g, "agent-notes", AUDIT_DIR_NAME));
  });

  test("log filename uses agent slug", () => {
    const g = gid();
    expect(getAuditLogPath(g, "Grimbold Ironforge")).toBe(
      path.join(TEST_DATA_DIR, g, "agent-notes", AUDIT_DIR_NAME, "grimbold-ironforge.log"),
    );
  });
});

describe("appendAuditEntry (file I/O)", () => {
  beforeEach(() => {
    counter++;
  });

  test("creates the .audit dir lazily and writes a line", async () => {
    const g = gid();
    expect(existsSync(getAuditDir(g))).toBe(false);

    await appendAuditEntry(g, "Grimbold Ironforge", 7, "Edit", "first edit summary");

    expect(existsSync(getAuditDir(g))).toBe(true);
    const contents = await readFile(getAuditLogPath(g, "Grimbold Ironforge"), "utf-8");
    expect(contents).toContain("turn=7");
    expect(contents).toContain("Edit");
    expect(contents).toContain("first edit summary");
    expect(contents.endsWith("\n")).toBe(true);
  });

  test("appends instead of overwriting", async () => {
    const g = gid();
    await appendAuditEntry(g, "Nyx Namfoodle", 1, "Edit", "first");
    await appendAuditEntry(g, "Nyx Namfoodle", 2, "Edit", "second");

    const contents = await readFile(getAuditLogPath(g, "Nyx Namfoodle"), "utf-8");
    const lines = contents.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("turn=1");
    expect(lines[1]).toContain("turn=2");
  });

  test("does not throw on filesystem errors (best-effort)", async () => {
    // Use a clearly invalid path component (null byte) to force an error.
    // Even on failure, the call must resolve without throwing.
    await expect(
      appendAuditEntry("\0invalid", "Agent", 1, "Edit", "summary"),
    ).resolves.toBeUndefined();
  });
});
