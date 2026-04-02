import { describe, test, expect, vi } from "vitest";
import {
  fetchProjectColumns,
  fetchAllProjectItems,
  fetchAllSyncedWorkItemIds,
  reconcileProjectToBoard,
} from "../src/rebuild.js";

function createMockOctokit(pages: any[][]) {
  let callIndex = 0;
  return {
    graphql: vi.fn().mockImplementation(() => {
      const items = pages[callIndex] ?? [];
      const hasNextPage = callIndex < pages.length - 1;
      callIndex++;
      return {
        node: {
          items: {
            pageInfo: { hasNextPage, endCursor: hasNextPage ? `cursor_${callIndex}` : undefined },
            nodes: items,
          },
        },
      };
    }),
  };
}

function makeProjectNode(number: number, title: string, status?: string) {
  return {
    fieldValues: {
      nodes: status
        ? [{ name: status, field: { name: "Status" } }]
        : [],
    },
    content: {
      title,
      body: `Body of ${title}`,
      number,
      repository: { owner: { login: "test-owner" }, name: "test-repo" },
      labels: { nodes: [{ name: "bug" }] },
    },
  };
}

function createMockMapping() {
  return {
    githubProject: { number: 1, id: 100, nodeId: "PVT_test" },
    azureDevOps: {
      organization: "test-org",
      project: "test-project",
      team: "test-team",
      board: "Issues",
    },
    enabled: true,
  };
}

describe("fetchProjectColumns", () => {
  test("extracts Status field options as column names", async () => {
    const octokit = {
      graphql: vi.fn().mockResolvedValue({
        node: {
          fields: {
            nodes: [
              { name: "Title" },
              {
                name: "Status",
                options: [
                  { name: "To Do" },
                  { name: "In Progress" },
                  { name: "Done" },
                ],
              },
            ],
          },
        },
      }),
    };

    const columns = await fetchProjectColumns(octokit, "PVT_test");
    expect(columns).toEqual(["To Do", "In Progress", "Done"]);
  });

  test("returns empty array when no Status field", async () => {
    const octokit = {
      graphql: vi.fn().mockResolvedValue({
        node: { fields: { nodes: [{ name: "Title" }] } },
      }),
    };

    const columns = await fetchProjectColumns(octokit, "PVT_test");
    expect(columns).toEqual([]);
  });
});

describe("fetchAllProjectItems", () => {
  test("fetches a single page of items", async () => {
    const octokit = createMockOctokit([
      [makeProjectNode(1, "Issue 1", "To Do"), makeProjectNode(2, "Issue 2", "In Progress")],
    ]);

    const items = await fetchAllProjectItems(octokit, "PVT_test");

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: "Issue 1",
      number: 1,
      status: "To Do",
      repoOwner: "test-owner",
    });
    expect(items[1].status).toBe("In Progress");
  });

  test("paginates through multiple pages", async () => {
    const octokit = createMockOctokit([
      [makeProjectNode(1, "Issue 1", "To Do")],
      [makeProjectNode(2, "Issue 2", "Done")],
    ]);

    const items = await fetchAllProjectItems(octokit, "PVT_test");
    expect(items).toHaveLength(2);
    expect(octokit.graphql).toHaveBeenCalledTimes(2);
  });

  test("skips draft items with no content", async () => {
    const octokit = createMockOctokit([
      [makeProjectNode(1, "Real Issue", "To Do"), { fieldValues: { nodes: [] }, content: null }],
    ]);

    const items = await fetchAllProjectItems(octokit, "PVT_test");
    expect(items).toHaveLength(1);
  });

  test("skips draft issues without repository", async () => {
    const octokit = createMockOctokit([
      [
        makeProjectNode(1, "Real Issue", "To Do"),
        { fieldValues: { nodes: [] }, content: { title: "Draft", body: "" } },
      ],
    ]);

    const items = await fetchAllProjectItems(octokit, "PVT_test");
    expect(items).toHaveLength(1);
  });
});

describe("fetchAllSyncedWorkItemIds", () => {
  test("returns list of work item IDs", async () => {
    const mapping = createMockMapping();
    const conn = {
      getWorkItemTrackingApi: vi.fn().mockResolvedValue({
        queryByWiql: vi.fn().mockResolvedValue({
          workItems: [{ id: 10 }, { id: 20 }, { id: 30 }],
        }),
      }),
    };

    const ids = await fetchAllSyncedWorkItemIds(conn as any, mapping);
    expect(ids).toEqual([10, 20, 30]);
  });

  test("returns empty array when no work items", async () => {
    const mapping = createMockMapping();
    const conn = {
      getWorkItemTrackingApi: vi.fn().mockResolvedValue({
        queryByWiql: vi.fn().mockResolvedValue({ workItems: [] }),
      }),
    };

    const ids = await fetchAllSyncedWorkItemIds(conn as any, mapping);
    expect(ids).toEqual([]);
  });
});

describe("reconcileProjectToBoard", () => {
  test("deletes existing work items and recreates from GitHub Project", async () => {
    const graphqlResponses: any[] = [];
    let graphqlCallIndex = 0;

    // First call: fetchProjectColumns
    graphqlResponses.push({
      node: {
        fields: {
          nodes: [{ name: "Status", options: [{ name: "To Do" }, { name: "Done" }] }],
        },
      },
    });
    // Second call: fetchAllProjectItems (one page)
    graphqlResponses.push({
      node: {
        items: {
          pageInfo: { hasNextPage: false, endCursor: undefined },
          nodes: [makeProjectNode(1, "Test Issue", "To Do")],
        },
      },
    });

    const octokit = {
      graphql: vi.fn().mockImplementation(() => graphqlResponses[graphqlCallIndex++]),
      issues: { listComments: vi.fn().mockResolvedValue({ data: [] }) },
    };

    const mapping = createMockMapping();
    const deleteWorkItem = vi.fn().mockResolvedValue({});
    const createWorkItemMock = vi.fn().mockResolvedValue({ id: 100 });

    const conn = {
      getWorkItemTrackingApi: vi.fn().mockResolvedValue({
        queryByWiql: vi.fn()
          .mockResolvedValueOnce({ workItems: [{ id: 50 }] })  // fetchAllSyncedWorkItemIds
          .mockResolvedValue({ workItems: [] }),                // findExistingWorkItem calls
        deleteWorkItem,
        createWorkItem: createWorkItemMock,
        getWorkItem: vi.fn().mockResolvedValue({ id: 100, fields: {} }),
        updateWorkItem: vi.fn().mockResolvedValue({}),
        getComments: vi.fn().mockResolvedValue({ comments: [] }),
        addComment: vi.fn().mockResolvedValue({}),
        getTags: vi.fn().mockResolvedValue([]),
      }),
      getWorkApi: vi.fn().mockResolvedValue({
        getBoardColumns: vi.fn().mockResolvedValue([
          { name: "To Do", columnType: 0, stateMappings: { Issue: "To Do" } },
          { name: "Done", columnType: 2, stateMappings: { Issue: "Done" } },
        ]),
        updateBoardColumns: vi.fn().mockResolvedValue({}),
      }),
    };

    const result = await reconcileProjectToBoard(octokit, conn as any, mapping);

    expect(deleteWorkItem).toHaveBeenCalledWith(50, "test-project", true);
    expect(result.deleted).toBe(1);
    expect(result.created).toBe(1);
  });
});
