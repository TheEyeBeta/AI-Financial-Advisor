import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guards the machine-readable critical-journey matrix
 * (docs/tests/critical-journeys.json — Phase 2 of the beta-readiness plan).
 *
 * The load-bearing rule: no journey may claim automated-test evidence unless
 * it cites at least one evidence file that actually exists in the repo. This
 * makes "marked complete without evidence" a CI failure, not a review nit.
 */

const repoRoot = resolve(__dirname, "../..");
const matrixPath = resolve(repoRoot, "docs/tests/critical-journeys.json");

const ALLOWED_STATUSES = [
  "IMPLEMENTED",
  "AUTOMATED_TEST_PASSED",
  "MANUAL_VERIFICATION_REQUIRED",
  "EXTERNAL_ACCESS_REQUIRED",
  "NOT_VERIFIED",
  "BLOCKED",
] as const;

const ALLOWED_PRIORITIES = ["P0", "P1", "P2"] as const;

interface Journey {
  id: string;
  name: string;
  area: string;
  priority: string;
  preconditions: string;
  steps: string;
  expected: string;
  data_written: string;
  external_deps: string[];
  coverage: { unit: string[]; integration: string[]; e2e: string[] };
  manual_required: boolean;
  status: string;
  evidence: string[];
  notes?: string;
}

const matrix = JSON.parse(readFileSync(matrixPath, "utf8")) as {
  version: number;
  updated: string;
  journeys: Journey[];
};

describe("critical-journeys.json", () => {
  it("parses and has journeys", () => {
    expect(matrix.version).toBeGreaterThanOrEqual(1);
    expect(matrix.journeys.length).toBeGreaterThan(0);
  });

  it("has unique journey ids", () => {
    const ids = matrix.journeys.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has a valid updated date", () => {
    expect(matrix.updated, "matrix.updated must be YYYY-MM-DD").toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("every journey has the required fields with allowed values", () => {
    for (const j of matrix.journeys) {
      expect(j.id, "journey id").toMatch(/^[a-z0-9-]+$/);
      expect(ALLOWED_PRIORITIES, `${j.id}: priority`).toContain(j.priority);
      expect(ALLOWED_STATUSES, `${j.id}: status`).toContain(j.status);
      // Runtime-check every declared field — the TypeScript cast above
      // performs no validation on the JSON.
      for (const field of [
        "name",
        "area",
        "preconditions",
        "steps",
        "expected",
        "data_written",
      ] as const) {
        expect(typeof j[field], `${j.id}: ${field} must be a non-empty string`).toBe("string");
        expect(j[field].length, `${j.id}: ${field} must be non-empty`).toBeGreaterThan(0);
      }
      expect(typeof j.manual_required, `${j.id}: manual_required`).toBe("boolean");
      expect(Array.isArray(j.external_deps), `${j.id}: external_deps array`).toBe(true);
      expect(Array.isArray(j.evidence), `${j.id}: evidence array`).toBe(true);
      for (const layer of ["unit", "integration", "e2e"] as const) {
        expect(Array.isArray(j.coverage?.[layer]), `${j.id}: coverage.${layer}`).toBe(true);
      }
    }
  });

  it("AUTOMATED_TEST_PASSED requires at least one existing, test-shaped evidence file", () => {
    // A doc or source file existing is not test evidence. At least one cited
    // path must be a regular file that matches the repo's test conventions.
    const testFilePattern = /(\.test\.[jt]sx?|\.spec\.[jt]s|\/test_[^/]+\.py)$/;
    for (const j of matrix.journeys) {
      if (j.status !== "AUTOMATED_TEST_PASSED") continue;
      expect(
        j.evidence.length,
        `${j.id}: AUTOMATED_TEST_PASSED with no cited evidence`,
      ).toBeGreaterThan(0);
      for (const path of j.evidence) {
        expect(
          existsSync(resolve(repoRoot, path)),
          `${j.id}: cited evidence file does not exist: ${path}`,
        ).toBe(true);
      }
      const hasTestArtifact = j.evidence.some((path) => {
        const full = resolve(repoRoot, path);
        return testFilePattern.test(path) && existsSync(full) && statSync(full).isFile();
      });
      expect(
        hasTestArtifact,
        `${j.id}: AUTOMATED_TEST_PASSED must cite at least one actual test file (*.test.*, *.spec.*, test_*.py)`,
      ).toBe(true);
    }
  });

  it("all cited coverage and evidence paths exist in the repo", () => {
    for (const j of matrix.journeys) {
      const paths = [
        ...j.coverage.unit,
        ...j.coverage.integration,
        ...j.coverage.e2e,
        ...j.evidence,
      ];
      for (const path of paths) {
        expect(
          existsSync(resolve(repoRoot, path)),
          `${j.id}: path does not exist: ${path}`,
        ).toBe(true);
      }
    }
  });

  it("P0 journeys are never left silently unverified — they must carry a note or a non-empty status rationale when not automated", () => {
    for (const j of matrix.journeys) {
      if (j.priority !== "P0") continue;
      if (j.status === "AUTOMATED_TEST_PASSED") continue;
      expect(
        (j.notes ?? "").length,
        `${j.id}: P0 journey without automated evidence must explain its status in notes`,
      ).toBeGreaterThan(0);
    }
  });
});
