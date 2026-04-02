import * as azdev from "azure-devops-node-api";
import {
  SyncMapping,
  createWorkItem,
} from "./index.js";
import { fetchIssueComments, syncCommentsToWorkItem } from "./comments.js";

interface ProjectItem {
  title: string;
  body: string;
  number: number;
  repoOwner: string;
  repoName: string;
  labels: string[];
  status: string | undefined;
}

export async function fetchProjectColumns(
  octokit: any,
  projectNodeId: string
): Promise<string[]> {
  const query = `
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes {
              ... on ProjectV2SingleSelectField {
                name
                options { name }
              }
            }
          }
        }
      }
    }
  `;

  const response: any = await octokit.graphql(query, { projectId: projectNodeId });
  const fields = response.node?.fields?.nodes || [];

  for (const field of fields) {
    if (field.name === "Status" && field.options) {
      const columns = field.options.map((opt: any) => opt.name);
      console.log(`Found ${columns.length} column(s) in GitHub Project: [${columns.join(", ")}]`);
      return columns;
    }
  }

  console.log("No Status field found in GitHub Project");
  return [];
}

export async function fetchAllProjectItems(
  octokit: any,
  projectNodeId: string
): Promise<ProjectItem[]> {
  const query = `
    query($projectId: ID!, $after: String) {
      node(id: $projectId) {
        ... on ProjectV2 {
          items(first: 100, after: $after) {
            pageInfo { hasNextPage, endCursor }
            nodes {
              fieldValues(first: 20) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field { ... on ProjectV2SingleSelectField { name } }
                  }
                }
              }
              content {
                ... on Issue {
                  title
                  body
                  number
                  repository {
                    owner { login }
                    name
                  }
                  labels(first: 50) { nodes { name } }
                }
                ... on PullRequest {
                  title
                  body
                  number
                  repository {
                    owner { login }
                    name
                  }
                  labels(first: 50) { nodes { name } }
                }
              }
            }
          }
        }
      }
    }
  `;

  const allItems: ProjectItem[] = [];
  let hasNextPage = true;
  let endCursor: string | undefined = undefined;

  while (hasNextPage) {
    const response: any = await octokit.graphql(query, {
      projectId: projectNodeId,
      after: endCursor ?? null,
    });

    const itemsPage = response.node?.items;
    if (!itemsPage) break;

    for (const node of itemsPage.nodes) {
      if (!node.content) continue;

      const content = node.content;
      if (!content.repository) continue;

      let status: string | undefined = undefined;

      if (node.fieldValues?.nodes) {
        for (const fv of node.fieldValues.nodes) {
          if (fv.field?.name === "Status" && fv.name) {
            status = fv.name;
            break;
          }
        }
      }

      allItems.push({
        title: content.title,
        body: content.body || "",
        number: content.number,
        repoOwner: content.repository.owner.login,
        repoName: content.repository.name,
        labels: (content.labels?.nodes || [])
          .map((l: any) => l.name)
          .filter((n: string) => n.length > 0),
        status,
      });
    }

    hasNextPage = itemsPage.pageInfo.hasNextPage;
    endCursor = itemsPage.pageInfo.endCursor;
  }

  console.log(`Fetched ${allItems.length} item(s) from GitHub Project`);
  return allItems;
}

export async function fetchAllSyncedWorkItemIds(
  connection: azdev.WebApi,
  mapping: SyncMapping
): Promise<number[]> {
  const workItemTrackingApi = await connection.getWorkItemTrackingApi();
  const project = mapping.azureDevOps.project;

  const wiql = {
    query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.Tags] CONTAINS 'GitHub Import' AND [System.WorkItemType] = 'Issue'`,
  };

  const queryResult = await workItemTrackingApi.queryByWiql(wiql);

  if (!queryResult.workItems || queryResult.workItems.length === 0) {
    console.log("No synced work items found in ADO");
    return [];
  }

  const ids = queryResult.workItems
    .map((wi) => wi.id)
    .filter((id): id is number => id !== undefined);

  console.log(`Found ${ids.length} synced work item(s) in ADO to delete`);
  return ids;
}

async function deleteAllSyncedWorkItems(
  connection: azdev.WebApi,
  mapping: SyncMapping
): Promise<number> {
  const ids = await fetchAllSyncedWorkItemIds(connection, mapping);
  if (ids.length === 0) return 0;

  const workItemTrackingApi = await connection.getWorkItemTrackingApi();
  const project = mapping.azureDevOps.project;
  let deleted = 0;

  for (const id of ids) {
    try {
      await workItemTrackingApi.deleteWorkItem(id, project, true);
      deleted++;
    } catch (error) {
      console.error(`Error deleting work item ${id}:`, error);
    }
  }

  console.log(`Deleted ${deleted}/${ids.length} existing work item(s) from ADO`);
  return deleted;
}

function isToDoColumn(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === "to do" || normalized === "to-do";
}

function isDoneColumn(name: string): boolean {
  return name.toLowerCase() === "done";
}

async function ensureAdoBoardColumns(
  connection: azdev.WebApi,
  mapping: SyncMapping,
  githubColumns: string[]
): Promise<void> {
  const workApi = await connection.getWorkApi();
  const teamContext = {
    project: mapping.azureDevOps.project,
    team: mapping.azureDevOps.team,
  };

  const existingColumns = await workApi.getBoardColumns(teamContext, mapping.azureDevOps.board);
  if (!existingColumns || existingColumns.length === 0) {
    console.error("Could not retrieve existing board columns");
    return;
  }

  const incomingColumn = existingColumns.find((col: any) => col.columnType === 0);
  const outgoingColumn = existingColumns.find((col: any) => col.columnType === 2);

  if (!incomingColumn || !outgoingColumn) {
    console.error("Could not find Incoming or Outgoing columns in ADO board");
    return;
  }

  const existingInProgressColumn = existingColumns.find(
    (col: any) => col.columnType === 1 && col.stateMappings
  );
  const stateMappings = existingInProgressColumn?.stateMappings || {
    Issue: "To Do",
  };

  const inProgressColumns = githubColumns
    .filter((name) => !isToDoColumn(name) && !isDoneColumn(name))
    .map((name) => ({
      name,
      columnType: 1,
      itemLimit: 0,
      isSplit: false,
      stateMappings,
      description: "",
    }));

  const updatedColumns = [incomingColumn, ...inProgressColumns, outgoingColumn];

  const existingNames = existingColumns.map((c: any) => c.name).join(", ");
  const newNames = updatedColumns.map((c: any) => c.name).join(", ");
  console.log(`Reordering ADO columns: [${existingNames}] → [${newNames}]`);

  await workApi.updateBoardColumns(updatedColumns, teamContext, mapping.azureDevOps.board);
  console.log("ADO board columns updated successfully");
}

export async function reconcileProjectToBoard(
  octokit: any,
  connection: azdev.WebApi,
  mapping: SyncMapping
): Promise<{ created: number; deleted: number }> {
  console.log("=== Starting full board rebuild ===");

  console.log("\n📋 Step 1: Fetching GitHub Project columns and items...");
  const githubColumns = await fetchProjectColumns(octokit, mapping.githubProject.nodeId);
  const projectItems = await fetchAllProjectItems(octokit, mapping.githubProject.nodeId);

  const itemsByColumn = new Map<string, ProjectItem[]>();
  const noColumnItems: ProjectItem[] = [];
  for (const item of projectItems) {
    if (item.status) {
      const existing = itemsByColumn.get(item.status) || [];
      existing.push(item);
      itemsByColumn.set(item.status, existing);
    } else {
      noColumnItems.push(item);
    }
  }

  console.log(`\nItems by column:`);
  for (const [col, items] of itemsByColumn) {
    console.log(`  ${col}: ${items.length} item(s)`);
  }
  if (noColumnItems.length > 0) {
    console.log(`  (no column): ${noColumnItems.length} item(s)`);
  }

  console.log("\n🗑️  Step 2: Deleting all existing synced work items from ADO...");
  const deleted = await deleteAllSyncedWorkItems(connection, mapping);

  console.log("\n📊 Step 3: Ensuring ADO board has all GitHub Project columns...");
  await ensureAdoBoardColumns(connection, mapping, githubColumns);

  console.log("\n🔨 Step 4: Creating work items in ADO by column...");
  let created = 0;

  for (const columnName of githubColumns) {
    const items = itemsByColumn.get(columnName) || [];
    if (items.length === 0) continue;

    console.log(`\n  Column "${columnName}": creating ${items.length} work item(s)...`);

    for (const item of items) {
      const ghId = `${item.repoOwner}/${item.repoName}#${item.number}`;

      const newWorkItem = await createWorkItem(
        connection,
        mapping,
        item.title,
        item.body,
        item.repoOwner,
        item.repoName,
        item.number,
        columnName,
        item.labels
      );

      if (newWorkItem?.id) {
        const comments = await fetchIssueComments(
          { octokit },
          item.repoOwner,
          item.repoName,
          item.number
        );
        if (comments.length > 0) {
          await syncCommentsToWorkItem(connection, mapping, newWorkItem.id, comments);
        }
        console.log(`    ✓ ${ghId} → work item ${newWorkItem.id}`);
      }

      created++;
    }
  }

  if (noColumnItems.length > 0) {
    console.log(`\n  (no column): creating ${noColumnItems.length} work item(s)...`);
    for (const item of noColumnItems) {
      const ghId = `${item.repoOwner}/${item.repoName}#${item.number}`;

      const newWorkItem = await createWorkItem(
        connection,
        mapping,
        item.title,
        item.body,
        item.repoOwner,
        item.repoName,
        item.number,
        undefined,
        item.labels
      );

      if (newWorkItem?.id) {
        const comments = await fetchIssueComments(
          { octokit },
          item.repoOwner,
          item.repoName,
          item.number
        );
        if (comments.length > 0) {
          await syncCommentsToWorkItem(connection, mapping, newWorkItem.id, comments);
        }
        console.log(`    ✓ ${ghId} → work item ${newWorkItem.id}`);
      }

      created++;
    }
  }

  console.log(
    `\n=== Rebuild complete: ${deleted} deleted, ${created} created across ${itemsByColumn.size} column(s) ===`
  );
  return { created, deleted };
}
