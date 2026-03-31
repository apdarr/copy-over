import { describe, test, expect, vi, beforeEach } from "vitest";
import { deleteWorkItemForIssue, findExistingWorkItem } from "../src/index.js";

function createMockMapping() {
  return {
    githubProject: { number: 3, id: 101, nodeId: "PVT_test123" },
    azureDevOps: {
      organization: "test-org",
      project: "test-project",
      team: "test-team",
      board: "Issues",
    },
    enabled: true,
  };
}

function createMockConnection(overrides: {
  queryResult?: { workItems: { id: number }[] };
  workItem?: { id: number; fields?: Record<string, any> };
  deleteResult?: any;
  deleteError?: Error;
}) {
  const deleteWorkItem = overrides.deleteError
    ? vi.fn().mockRejectedValue(overrides.deleteError)
    : vi.fn().mockResolvedValue(overrides.deleteResult ?? {});

  const getWorkItem = vi
    .fn()
    .mockResolvedValue(overrides.workItem ?? { id: 42 });

  const queryByWiql = vi.fn().mockResolvedValue(
    overrides.queryResult ?? { workItems: [] }
  );

  const workItemTrackingApi = {
    queryByWiql,
    getWorkItem,
    deleteWorkItem,
  };

  return {
    getWorkItemTrackingApi: vi.fn().mockResolvedValue(workItemTrackingApi),
    _mocks: { deleteWorkItem, getWorkItem, queryByWiql },
  };
}

describe("findExistingWorkItem", () => {
  test("returns work item when found by tag", async () => {
    const mapping = createMockMapping();
    const conn = createMockConnection({
      queryResult: { workItems: [{ id: 42 }] },
      workItem: { id: 42, fields: { "System.Title": "Test Issue" } },
    });

    const result = await findExistingWorkItem(
      conn as any,
      mapping,
      "test-owner",
      "test-repo",
      7
    );

    expect(result).toBeDefined();
    expect(result.id).toBe(42);
    expect(conn._mocks.queryByWiql).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining("test-owner/test-repo#7"),
      })
    );
  });

  test("returns null when no work item matches", async () => {
    const mapping = createMockMapping();
    const conn = createMockConnection({
      queryResult: { workItems: [] },
    });

    const result = await findExistingWorkItem(
      conn as any,
      mapping,
      "test-owner",
      "test-repo",
      99
    );

    expect(result).toBeNull();
  });
});

describe("deleteWorkItemForIssue", () => {
  test("deletes existing ADO work item and returns true", async () => {
    const mapping = createMockMapping();
    const conn = createMockConnection({
      queryResult: { workItems: [{ id: 42 }] },
      workItem: { id: 42 },
    });

    const result = await deleteWorkItemForIssue(
      conn as any,
      mapping,
      "test-owner",
      "test-repo",
      7
    );

    expect(result).toBe(true);
    expect(conn._mocks.deleteWorkItem).toHaveBeenCalledWith(
      42,
      "test-project",
      true
    );
  });

  test("returns false when no matching work item exists", async () => {
    const mapping = createMockMapping();
    const conn = createMockConnection({
      queryResult: { workItems: [] },
    });

    const result = await deleteWorkItemForIssue(
      conn as any,
      mapping,
      "test-owner",
      "test-repo",
      99
    );

    expect(result).toBe(false);
    expect(conn._mocks.deleteWorkItem).not.toHaveBeenCalled();
  });

  test("returns false when ADO delete API throws an error", async () => {
    const mapping = createMockMapping();
    const conn = createMockConnection({
      queryResult: { workItems: [{ id: 42 }] },
      workItem: { id: 42 },
      deleteError: new Error("ADO API failure"),
    });

    const result = await deleteWorkItemForIssue(
      conn as any,
      mapping,
      "test-owner",
      "test-repo",
      7
    );

    expect(result).toBe(false);
    expect(conn._mocks.deleteWorkItem).toHaveBeenCalledWith(
      42,
      "test-project",
      true
    );
  });
});
