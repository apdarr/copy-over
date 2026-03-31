import { Probot } from "probot";
import * as azdev from "azure-devops-node-api";
import { fetchIssueComments, syncCommentsToWorkItem } from "./comments.js";

const itemProcessingLocks = new Map<string, Promise<any>>();

async function withItemLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  while (itemProcessingLocks.has(key)) {
    try {
      await itemProcessingLocks.get(key);
    } catch {
      // Ignore errors from previous processing
    }
  }

  const promise = fn();
  itemProcessingLocks.set(key, promise);

  try {
    return await promise;
  } finally {
    itemProcessingLocks.delete(key);
  }
}

// Interface for a single sync mapping
interface SyncMapping {
  githubProject: {
    number: number;
    id: number;
    nodeId: string;
  };
  azureDevOps: {
    organization: string;
    project: string;
    team: string;
    board: string;
  };
  enabled: boolean;
}

// Interface for the entire config file structure
interface SyncConfig {
  syncMappings: SyncMapping[];
}

// Interface for GitHub issue metadata
interface GitHubIssueMetadata {
  title: string;
  body: string;
  number: number;
  repository: {
    owner: { login: string };
    name: string;
  };
  labels?: { nodes: { name: string }[] };
}

const token: string = process.env.ADO_TOKEN || '';
const CONFIG_REPO_OWNER: string = process.env.CONFIG_REPO_OWNER || '';
const CONFIG_REPO_NAME: string = process.env.CONFIG_REPO_NAME || '';

/**
 * Get the config repository owner and name
 * Validates that required env vars are set
 */
function getConfigRepoPath(): { owner: string; repo: string } {
  if (!CONFIG_REPO_OWNER || !CONFIG_REPO_NAME) {
    throw new Error(
      'CONFIG_REPO_OWNER and CONFIG_REPO_NAME environment variables are required. ' +
      'Set these to specify where the sync configuration file is stored.'
    );
  }
  return {
    owner: CONFIG_REPO_OWNER,
    repo: CONFIG_REPO_NAME
  };
}

/**
 * Load sync configuration from repository
 */
async function loadSyncConfig(context: any): Promise<SyncConfig | undefined> {
  try {
    const { owner, repo } = getConfigRepoPath();
    const { data } = await context.octokit.repos.getContent({
      owner,
      repo,
      path: '.github/copy-over-config.json'
    });

    if (data) {
      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      const config = JSON.parse(content) as SyncConfig;
      console.log(`Loaded sync config with ${config.syncMappings?.length || 0} mapping(s)`);
      return config;
    }
  } catch (error) {
    console.log('No sync config found or error loading config:', error);
  }
  return undefined;
}

/**
 * Save sync configuration to repository
 */
async function saveSyncConfig(context: any, config: SyncConfig): Promise<void> {
  const content = JSON.stringify(config, null, 2);
  const encoded = Buffer.from(content).toString('base64');
  const { owner, repo } = getConfigRepoPath();
  
  try {
    // Try to get existing file
    const existing = await context.octokit.repos.getContent({
      owner,
      repo,
      path: '.github/copy-over-config.json'
    });
    
    // Update existing
    await context.octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: '.github/copy-over-config.json',
      message: 'Update copy-over sync configuration',
      content: encoded,
      sha: 'sha' in existing.data ? existing.data.sha : undefined
    });
  } catch (error) {
    // Create new file
    await context.octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: '.github/copy-over-config.json',
      message: 'Initialize copy-over sync configuration',
      content: encoded
    });
  }
}

/**
 * Parse configuration from issue form body
 */
function parseConfigIssue(issueBody: string): Partial<SyncMapping> | undefined {
  const mapping: any = { githubProject: {}, azureDevOps: {} };
  
  const projectNumberMatch = issueBody.match(/### GitHub Project Number\s*\n\s*(.+)/);
  const orgMatch = issueBody.match(/### Azure DevOps Organization\s*\n\s*(.+)/);
  const projectMatch = issueBody.match(/### Azure DevOps Project\s*\n\s*(.+)/);
  const teamMatch = issueBody.match(/### Azure DevOps Team\s*\n\s*(.+)/);
  const boardMatch = issueBody.match(/### Azure DevOps Board Name\s*\n\s*(.+)/);
  const actionMatch = issueBody.match(/### Action\s*\n\s*(.+)/);
  
  if (projectNumberMatch) {
    const num = parseInt(projectNumberMatch[1].trim(), 10);
    if (!isNaN(num)) {
      mapping.githubProject.number = num;
    }
  }
  if (orgMatch) mapping.azureDevOps.organization = orgMatch[1].trim();
  if (projectMatch) mapping.azureDevOps.project = projectMatch[1].trim();
  if (teamMatch) mapping.azureDevOps.team = teamMatch[1].trim();
  if (boardMatch) mapping.azureDevOps.board = boardMatch[1].trim();
  
  if (actionMatch) {
    const action = actionMatch[1].trim();
    mapping.enabled = action === 'Enable sync' || action === 'Update configuration';
  }
  
  return mapping;
}

/**
 * Fetch project details (id and node_id) from project number using REST API
 */
async function fetchProjectDetails(context: any, projectNumber: number): Promise<{ id: number; nodeId: string } | undefined> {
  try {
    // We're only fetching projects scoped to the org
    const owner = context.payload.repository.owner.login;
    
    const endpoint = `/orgs/${owner}/projectsV2`;
    const { data: projects } = await context.octokit.request(`GET ${endpoint}`, {
      headers: {
        accept: 'application/vnd.github+json'
      }
    });
    
    // Find the project with matching number
    const matchingProject = projects.find((p: any) => p.number === projectNumber);
    
    if (!matchingProject) {
      console.error(`Could not find project with number ${projectNumber}`);
      return undefined;
    }
    
    console.log(`Found project #${projectNumber}: ${matchingProject.title} (id: ${matchingProject.id}, node_id: ${matchingProject.node_id})`);
    return {
      id: matchingProject.id,
      nodeId: matchingProject.node_id
    };
  } catch (error) {
    console.error(`Error fetching project details for number ${projectNumber}:`, error);
    return undefined;
  }
}

/**
 * Find sync mapping for a given project node_id
 */
function findSyncMapping(config: SyncConfig, projectNodeId: string): SyncMapping | undefined {
  return config.syncMappings?.find(m => m.githubProject.nodeId === projectNodeId);
}

/**
 * Create Azure DevOps connection from mapping
 */
function createAdoConnection(mapping: SyncMapping): azdev.WebApi {
  const orgUrl = `https://dev.azure.com/${mapping.azureDevOps.organization}`;
  const authHandler = azdev.getPersonalAccessTokenHandler(token);
  return new azdev.WebApi(orgUrl, authHandler);
}

/**
 * Extract current column from project item field values
 */
function extractCurrentColumn(item: any): string | undefined {
  // Check if we have field_values in the payload
  if (item.field_values && Array.isArray(item.field_values)) {
    for (const fieldValue of item.field_values) {
      // Look for single_select field values (Status field)
      if (fieldValue.field && fieldValue.field.name === 'Status' && 
          fieldValue.option_name) {
        console.log(`Found current column in payload: ${fieldValue.option_name}`);
        return fieldValue.option_name;
      }
    }
  }

  // Also check if field values are nested differently
  if (item.fieldValues && item.fieldValues.nodes) {
    for (const fieldValue of item.fieldValues.nodes) {
      if (fieldValue.field && fieldValue.field.name === 'Status' && 
          fieldValue.name) {
        console.log(`Found current column in fieldValues.nodes: ${fieldValue.name}`);
        return fieldValue.name;
      }
    }
  }

  console.log("No current column found in project item payload");
  return undefined;
}

/**
 * Fetch issue metadata from GitHub using GraphQL
 */
async function fetchIssueMetadata(context: any, nodeId: string): Promise<GitHubIssueMetadata | null> {
  try {
    console.log(`Attempting to fetch issue metadata for node ID: ${nodeId}`);
    console.log(`Context octokit available: ${!!context.octokit}`);
    console.log(`Context octokit.graphql available: ${!!context.octokit?.graphql}`);

    if (!context.octokit || !context.octokit.graphql) {
      console.error("GitHub GraphQL client not available in context");
      return null;
    }

    const query = `
      query($nodeId: ID!) {
        node(id: $nodeId) {
          ... on Issue {
            title
            body
            number
            repository {
              owner {
                login
              }
              name
            }
            labels(first: 50) {
              nodes { name }
            }
          }
          ... on PullRequest {
            title
            body
            number
            repository {
              owner {
                login
              }
              name
            }
            labels(first: 50) {
              nodes { name }
            }
          }
        }
      }
    `;

    console.log("Executing GraphQL query...");
    const response = await context.octokit.graphql(query, {
      nodeId: nodeId
    });

    console.log("GraphQL response received:", JSON.stringify(response, null, 2));
    return response.node as GitHubIssueMetadata;
  } catch (error: any) {
    console.error("Error fetching issue metadata:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    return null;
  }
}

// Helper function to search for existing work items by GitHub identifier
export async function findExistingWorkItem(connection: azdev.WebApi, mapping: SyncMapping, repoOwner: string, repoName: string, issueNumber: number): Promise<any | null> {
  try {
    const workItemTrackingApi = await connection.getWorkItemTrackingApi();
    const project = mapping.azureDevOps.project;
    
    // Create the GitHub identifier tag we're looking for
    const githubIdentifier = `${repoOwner}/${repoName}#${issueNumber}`;
    
    // Search for work items with the GitHub identifier in tags
    const wiql = {
      query: `SELECT [System.Id], [System.Title], [System.Tags] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.Tags] CONTAINS '${githubIdentifier}' AND [System.WorkItemType] = 'Issue'`
    };
    
    const queryResult = await workItemTrackingApi.queryByWiql(wiql);
    
    if (queryResult.workItems && queryResult.workItems.length > 0) {
      // Return the first matching work item ID
      const workItemId = queryResult.workItems[0].id;
      if (workItemId) {
        const workItem = await workItemTrackingApi.getWorkItem(workItemId);
        console.log(`Found existing work item: ID ${workItemId} for ${githubIdentifier}`);
        return workItem;
      }
    }
    
    console.log(`No existing work item found for ${githubIdentifier}`);
    return null;
  } catch (error) {
    console.error("Error searching for existing work item:", error);
    return null;
  }
}

export async function deleteWorkItemForIssue(
  connection: azdev.WebApi,
  mapping: SyncMapping,
  repoOwner: string,
  repoName: string,
  issueNumber: number
): Promise<boolean> {
  const githubIdentifier = `${repoOwner}/${repoName}#${issueNumber}`;
  const existingWorkItem = await findExistingWorkItem(connection, mapping, repoOwner, repoName, issueNumber);

  if (!existingWorkItem?.id) {
    console.log(`No ADO work item found for ${githubIdentifier}. Nothing to delete.`);
    return false;
  }

  try {
    const workItemTrackingApi = await connection.getWorkItemTrackingApi();
    await workItemTrackingApi.deleteWorkItem(existingWorkItem.id, mapping.azureDevOps.project, true);
    console.log(`Deleted ADO work item ${existingWorkItem.id} for ${githubIdentifier}`);
    return true;
  } catch (error) {
    console.error(`Error deleting ADO work item ${existingWorkItem.id} for ${githubIdentifier}:`, error);
    return false;
  }
}

/**
 * Shared function to handle project item synchronization
 * Works for both creation and editing events
 */
async function handleProjectItemSync(context: any, item: any, mapping: SyncMapping, connection: azdev.WebApi, eventTargetColumn?: string): Promise<any> {
  console.log("=== handleProjectItemSync START ===");
  console.log("Item content_node_id:", item.content_node_id);
  console.log("Initial eventTargetColumn (from edit event, if any):", eventTargetColumn);

  if (!item.content_node_id) {
    console.log("Item does not have a content_node_id (e.g., draft issue). Skipping sync.");
    return null;
  }

  return withItemLock(item.content_node_id, async () => {
    console.log(`Lock acquired for ${item.content_node_id}`);

    const issueMetadata = await fetchIssueMetadata(context, item.content_node_id);
    if (!issueMetadata) {
      console.log("Could not fetch issue metadata from GitHub. Skipping sync.");
      return null;
    }

    const { title: issueTitle, body: issueBody = "", number: issueNumber } = issueMetadata;
    const { login: repoOwner } = issueMetadata.repository.owner;
    const { name: repoName } = issueMetadata.repository;
    const labelNames: string[] = (issueMetadata.labels?.nodes || [])
      .map(n => n?.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
    const githubIdentifier = `${repoOwner}/${repoName}#${issueNumber}`;
    console.log(`Processing GitHub Item: ${githubIdentifier} - "${issueTitle}"`);

    let finalTargetColumn: string | undefined = eventTargetColumn;

    if (!finalTargetColumn) {
      console.log("eventTargetColumn not provided (e.g., create event or non-column edit), attempting to extract current column from item payload.");
      const extractedColumn = extractCurrentColumn(item);
      if (extractedColumn) {
        console.log(`Extracted current column from item payload: ${extractedColumn}`);
        finalTargetColumn = extractedColumn;
      } else {
        console.log("Could not extract current column from item payload (item might be new or column info not present).");
      }
    }
    console.log(`Final target ADO column for sync: ${finalTargetColumn}`);

    const existingWorkItem = await findExistingWorkItem(connection, mapping, repoOwner, repoName, issueNumber);

    let workItem: any;

    if (existingWorkItem) {
      console.log(`Found existing ADO Work Item ID: ${existingWorkItem.id} for ${githubIdentifier}`);
      if (finalTargetColumn) {
        console.log(`Attempting to sync work item ${existingWorkItem.id} to column "${finalTargetColumn}"`);
        await updateWorkItemColumn(connection, mapping, existingWorkItem.id, finalTargetColumn);

        if (labelNames.length > 0) {
          console.log(`Syncing ${labelNames.length} labels to work item ${existingWorkItem.id}: [${labelNames.join(", ")}]`);
          await ensureLabelsOnWorkItem(connection, mapping, existingWorkItem.id, labelNames);
        }
      } else {
        console.log(`No specific target column determined for existing work item ${existingWorkItem.id}. No column update performed.`);
        if (labelNames.length > 0) {
          console.log(`Syncing ${labelNames.length} labels to work item ${existingWorkItem.id}: [${labelNames.join(", ")}]`);
          await ensureLabelsOnWorkItem(connection, mapping, existingWorkItem.id, labelNames);
        }
      }
      workItem = existingWorkItem;
    } else {
      console.log(`No existing ADO Work Item found for ${githubIdentifier}. Creating new one.`);
      workItem = await createWorkItem(
        connection,
        mapping,
        issueTitle,
        issueBody,
        repoOwner,
        repoName,
        issueNumber,
        finalTargetColumn,
        labelNames
      );
    }

    if (workItem?.id) {
      const comments = await fetchIssueComments(context, repoOwner, repoName, issueNumber);
      if (comments.length > 0) {
        await syncCommentsToWorkItem(connection, mapping, workItem.id, comments);
      }
    }

    return workItem;
  });
}

/**
 * Create a new work item in Azure DevOps
 */
async function createWorkItem(
  connection: azdev.WebApi,
  mapping: SyncMapping,
  title: string,
  description: string,
  repoOwner: string,
  repoName: string,
  issueNumber: number,
  targetColumn?: string,
  labels?: string[]
): Promise<any> {
  const workItemTrackingApi = await connection.getWorkItemTrackingApi();
  const project = mapping.azureDevOps.project;
  const workItemType = "Issue";

  // Create GitHub identifier tag
  const githubIdentifier = `${repoOwner}/${repoName}#${issueNumber}`;
  
  let tagsSet = new Set<string>();
  tagsSet.add("GitHub Import");
  tagsSet.add(githubIdentifier);
  for (const lbl of (labels || [])) {
    if (typeof lbl === 'string' && lbl.trim().length > 0) {
      tagsSet.add(lbl.trim());
    }
  }
  if (targetColumn) {
    // Ensure the target column exists in ADO board, creating it if necessary
    const columnReady = await ensureBoardColumn(connection, mapping, targetColumn);
    if (!columnReady) {
      tagsSet.add(`Missing destination column: ${targetColumn}`);
      console.log(`Could not create column "${targetColumn}" in ADO board. Added to tags.`);
    }
  }

  const tags = Array.from(tagsSet).join("; ");

  // Define the work item fields
  const patchDocument = [
    {
      op: "add",
      path: "/fields/System.Title",
      value: title
    },
    {
      op: "add",
      path: "/fields/System.Description",
      value: description
    },
    {
      op: "add",
      path: "/fields/System.Tags",
      value: tags
    }
  ];

  try {
    // Create the work item
    const createdWorkItem = await workItemTrackingApi.createWorkItem(
      null,
      patchDocument,
      project,
      workItemType
    );

    console.log(`Work item created: ID ${createdWorkItem.id} for ${githubIdentifier}`);

    // If targetColumn is specified and exists, move the work item there
    if (targetColumn) {
      console.log(`Attempting to move newly created work item ${createdWorkItem.id} to column "${targetColumn}"`);
      await updateWorkItemColumn(connection, mapping, createdWorkItem.id!, targetColumn);
    }

    return createdWorkItem;
  } catch (error) {
    console.error("Error creating work item:", error);
    throw error;
  }
}

/**
 * Check if a column exists in the ADO board
 */
async function checkColumnExists(connection: azdev.WebApi, mapping: SyncMapping, columnName: string): Promise<boolean> {
  try {
    const workApi = await connection.getWorkApi();
    const teamContext = {
      project: mapping.azureDevOps.project,
      team: mapping.azureDevOps.team
    };

    console.log(`Checking if column "${columnName}" exists in ADO board...`);
    const boardColumns = await workApi.getBoardColumns(teamContext, mapping.azureDevOps.board);
    
    if (!boardColumns || boardColumns.length === 0) {
      console.log("No board columns found or board columns is empty");
      return false;
    }

    // Log all available columns for debugging
    const availableColumns = boardColumns.map((col: any) => col.name).filter(Boolean);
    console.log(`Available ADO board columns: [${availableColumns.join(", ")}]`);
    
    const matchingColumn = boardColumns.find((col: any) => col.name === columnName);
    const exists = !!matchingColumn;
    
    console.log(`Column "${columnName}" exists in ADO: ${exists}`);
    return exists;
  } catch (error) {
    console.error("Error checking if column exists:", error);
    console.error("Error details:", {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : "Unknown"
    });
    return false;
  }
}

/**
 * Create a new column in the ADO board
 */
async function createBoardColumn(connection: azdev.WebApi, mapping: SyncMapping, columnName: string): Promise<boolean> {
  try {
    const workApi = await connection.getWorkApi();
    const teamContext = {
      project: mapping.azureDevOps.project,
      team: mapping.azureDevOps.team
    };

    console.log(`Creating new column "${columnName}" in ADO board...`);
    
    // Get current columns
    const existingColumns = await workApi.getBoardColumns(teamContext, mapping.azureDevOps.board);
    
    if (!existingColumns || existingColumns.length === 0) {
      console.error("Could not retrieve existing board columns");
      return false;
    }

    // Log existing columns and their state mappings for debugging
    console.log("Existing columns with state mappings:");
    existingColumns.forEach((col: any) => {
      console.log(`  - ${col.name}: ${JSON.stringify(col.stateMappings)}`);
    });

    // Find the last column (should be the "outgoing" column like "Done")
    // We need to insert the new column BEFORE the outgoing column
    const outgoingColumnIndex = existingColumns.findIndex(
      (col: any) => col.columnType === 2 // BoardColumnType.Outgoing = 2
    );

    // Find an existing InProgress column to copy state mappings from
    // This ensures we have the correct work item types and states
    const existingInProgressColumn = existingColumns.find(
      (col: any) => col.columnType === 1 && col.stateMappings
    );

    // Use state mappings from an existing InProgress column, or create a default mapping
    const stateMappings = existingInProgressColumn?.stateMappings || {
      "Issue": "To Do" // Default mapping for Issue work item type
    };

    // Create new column with default settings (no ID for new columns)
    const newColumn = {
      name: columnName,
      columnType: 1, // InProgress type
      itemLimit: 0,  // No WIP limit
      isSplit: false,
      stateMappings: stateMappings,
      description: ""
    };

    // Build the updated columns array, inserting new column before the outgoing column
    const updatedColumns = [...existingColumns];
    if (outgoingColumnIndex !== -1) {
      // Insert before the outgoing column
      updatedColumns.splice(outgoingColumnIndex, 0, newColumn);
    } else {
      // If no outgoing column found, append at the end (shouldn't happen normally)
      updatedColumns.push(newColumn);
    }

    // Update the board with the new column configuration
    await workApi.updateBoardColumns(updatedColumns, teamContext, mapping.azureDevOps.board);
    
    console.log(`Successfully created column "${columnName}" in ADO board`);
    return true;
  } catch (error) {
    console.error(`Error creating column "${columnName}":`, error);
    console.error("Error details:", {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : "Unknown"
    });
    return false;
  }
}

/**
 * Ensure a column exists in the ADO board, creating it if necessary
 */
async function ensureBoardColumn(connection: azdev.WebApi, mapping: SyncMapping, columnName: string): Promise<boolean> {
  const exists = await checkColumnExists(connection, mapping, columnName);
  
  if (exists) {
    console.log(`Column "${columnName}" already exists in ADO board`);
    return true;
  }
  
  console.log(`Column "${columnName}" does not exist. Attempting to create it...`);
  return await createBoardColumn(connection, mapping, columnName);
}

export default (app: Probot) => {
  // Handle configuration issues
  app.on(['issues.opened', 'issues.edited'], async (context) => {
    const issue = context.payload.issue;
    const labels = (issue.labels || []).map((l: any) => l.name);
    
    if (!labels.includes('sync-config')) {
      return;
    }
    
    console.log('📝 Processing sync configuration issue');
    
    const parsedMapping = parseConfigIssue(issue.body || '');
    if (!parsedMapping || !parsedMapping.githubProject?.number) {
      await context.octokit.issues.createComment({
        ...context.issue(),
        body: '❌ Unable to parse configuration. Please ensure all required fields are filled, including a valid GitHub Project Number.'
      });
      return;
    }
    
    // Fetch project details (id and node_id) from the project number
    const projectDetails = await fetchProjectDetails(context, parsedMapping.githubProject.number);
    if (!projectDetails) {
      await context.octokit.issues.createComment({
        ...context.issue(),
        body: `❌ Could not find GitHub Project with number ${parsedMapping.githubProject.number}. Please verify the project number is correct.`
      });
      return;
    }
    
    // Complete the mapping with full project details
    const completeMapping: SyncMapping = {
      githubProject: {
        number: parsedMapping.githubProject.number,
        id: projectDetails.id,
        nodeId: projectDetails.nodeId
      },
      azureDevOps: parsedMapping.azureDevOps as any,
      enabled: parsedMapping.enabled || false
    };
    
    // Load existing config or create new one
    let config = await loadSyncConfig(context);
    if (!config) {
      config = { syncMappings: [] };
    }
    
    // Find existing mapping for this project or add new one
    const existingIndex = config.syncMappings.findIndex(m => m.githubProject.nodeId === projectDetails.nodeId);
    if (existingIndex >= 0) {
      config.syncMappings[existingIndex] = completeMapping;
      console.log(`Updated existing mapping for project #${completeMapping.githubProject.number}`);
    } else {
      config.syncMappings.push(completeMapping);
      console.log(`Added new mapping for project #${completeMapping.githubProject.number}`);
    }
    
    await saveSyncConfig(context, config);
    
    await context.octokit.issues.createComment({
      ...context.issue(),
      body: `✅ Sync configuration ${completeMapping.enabled ? 'enabled' : 'disabled'} successfully for Project #${completeMapping.githubProject.number}!\n\nConfiguration saved to \`.github/copy-over-config.json\``
    });
    
    await context.octokit.issues.update({
      ...context.issue(),
      state: 'closed',
      labels: [...labels, 'configured']
    });
  });

  app.on("projects_v2_item.created", async (context) => {
    console.log("🆕 Project item created event received");
    
    const config = await loadSyncConfig(context);
    if (!config || !config.syncMappings || config.syncMappings.length === 0) {
      console.log('No sync mappings configured for this repository');
      return;
    }
    
    const item = context.payload.projects_v2_item;
    
    // Find the sync mapping for this project
    const mapping = findSyncMapping(config, item.project_node_id);
    if (!mapping) {
      console.log(`No sync mapping found for project node_id: ${item.project_node_id}`);
      return;
    }
    
    if (!mapping.enabled) {
      console.log(`Sync is disabled for project #${mapping.githubProject.number}`);
      return;
    }
    
    const connection = createAdoConnection(mapping);
    
    // For 'created' events, eventTargetColumn is undefined.
    // handleProjectItemSync will try to extract the column from the item's current field values.
    await handleProjectItemSync(context, item, mapping, connection);
  });

  app.on("projects_v2_item.edited", async (context) => {
    console.log("✏️ Project item edited event received");
    
    const config = await loadSyncConfig(context);
    if (!config || !config.syncMappings || config.syncMappings.length === 0) {
      console.log('No sync mappings configured for this repository');
      return;
    }
    
    const payload = context.payload;
    const item = payload.projects_v2_item; // This is the full state of the item *after* the edit.
    
    // Find the sync mapping for this project
    const mapping = findSyncMapping(config, item.project_node_id);
    if (!mapping) {
      console.log(`No sync mapping found for project node_id: ${item.project_node_id}`);
      return;
    }
    
    if (!mapping.enabled) {
      console.log(`Sync is disabled for project #${mapping.githubProject.number}`);
      return;
    }
    
    const connection = createAdoConnection(mapping);
    let determinedTargetColumn: string | undefined = undefined;

    // Check if the edit involved a change to a field value we care about (i.e., status column)
    if (payload.changes && payload.changes.field_value && 
        typeof payload.changes.field_value === 'object' && payload.changes.field_value !== null) {
      
      const fieldValChange = payload.changes.field_value as any; // Use 'as any' for flexibility, or a more specific type

      // We are interested if 'field_name' is 'Status' (or whatever your project calls it)
      // and if 'to' (the new value) has a 'name' property.
      // The exact structure of field_value can vary based on the field type.
      // For a single select field (like a status column), 'to' would be an object with a 'name'.
      if (fieldValChange.field_type === 'single_select' && 
          fieldValChange.field_name === 'Status' &&
          fieldValChange.to && typeof fieldValChange.to === 'object' && 
          typeof fieldValChange.to.name === 'string') {
        
        determinedTargetColumn = fieldValChange.to.name;
        console.log(`Detected column change in edit event. Field: "${fieldValChange.field_name}", New column: "${determinedTargetColumn}"`);
      } else {
        console.log("Edit event's field_value change was not a recognized status column change, or payload structure unexpected.");
        // console.log("Field value change details:", JSON.stringify(fieldValChange, null, 2)); // For debugging
      }
    } else {
      console.log("Edit event did not include specific field_value changes (e.g., title edit, or no changes block).");
    }

    // Always call handleProjectItemSync. 
    // If determinedTargetColumn is set, it attempts to move to that column.
    // If not, handleProjectItemSync will try to extract the item's *current* column from its payload
    // which is useful for ensuring the item is in the correct state if other edits occurred or for offline recovery.
    console.log(`Calling handleProjectItemSync for edited item. Determined target column from edit event: ${determinedTargetColumn}`);
    await handleProjectItemSync(context, item, mapping, connection, determinedTargetColumn);
  });

  app.on("projects_v2_item.deleted", async (context) => {
    console.log("🗑️ Project item deleted event received");

    const item = context.payload.projects_v2_item;

    if (!item.content_node_id) {
      console.log("Deleted item has no content_node_id (draft issue). Nothing to remove from ADO.");
      return;
    }

    const config = await loadSyncConfig(context);
    if (!config || !config.syncMappings || config.syncMappings.length === 0) {
      console.log("No sync mappings configured for this repository");
      return;
    }

    const mapping = findSyncMapping(config, item.project_node_id);
    if (!mapping) {
      console.log(`No sync mapping found for project node_id: ${item.project_node_id}`);
      return;
    }

    if (!mapping.enabled) {
      console.log(`Sync is disabled for project #${mapping.githubProject.number}`);
      return;
    }

    const issueMetadata = await fetchIssueMetadata(context, item.content_node_id);
    if (!issueMetadata) {
      console.log("Could not fetch issue metadata for deleted item. Skipping ADO deletion.");
      return;
    }

    const { login: repoOwner } = issueMetadata.repository.owner;
    const { name: repoName } = issueMetadata.repository;
    const issueNumber = issueMetadata.number;

    const connection = createAdoConnection(mapping);
    await deleteWorkItemForIssue(connection, mapping, repoOwner, repoName, issueNumber);
  });

  app.on("issue_comment.created", async (context) => {
    console.log("💬 Issue comment created event received");

    const comment = context.payload.comment;
    const issue = context.payload.issue;

    if (comment.user?.type === "Bot") {
      console.log("Skipping bot comment to avoid sync loops");
      return;
    }

    const config = await loadSyncConfig(context);
    if (!config || !config.syncMappings || config.syncMappings.length === 0) {
      console.log("No sync mappings configured for this repository");
      return;
    }

    const repoOwner = context.payload.repository.owner.login;
    const repoName = context.payload.repository.name;
    const issueNumber = issue.number;

    for (const mapping of config.syncMappings) {
      if (!mapping.enabled) continue;

      const connection = createAdoConnection(mapping);
      const existingWorkItem = await findExistingWorkItem(
        connection,
        mapping,
        repoOwner,
        repoName,
        issueNumber
      );

      if (!existingWorkItem?.id) continue;

      console.log(
        `Found ADO work item ${existingWorkItem.id} for ${repoOwner}/${repoName}#${issueNumber}. Syncing new comment.`
      );

      const ghComment = {
        id: comment.id,
        body: comment.body || "",
        user: { login: comment.user?.login || "unknown" },
        created_at: comment.created_at,
        updated_at: comment.updated_at,
      };

      await syncCommentsToWorkItem(connection, mapping, existingWorkItem.id, [ghComment]);
    }
  });
};

// Ensure specified labels exist as tags in the project and are applied to the work item
async function ensureLabelsOnWorkItem(connection: azdev.WebApi, mapping: SyncMapping, workItemId: number | undefined, labels: string[]): Promise<void> {
  if (!workItemId) return;
  if (!labels || labels.length === 0) return;

  try {
    const workItemTrackingApi = await connection.getWorkItemTrackingApi();
    const project = mapping.azureDevOps.project;

    const workItem = await workItemTrackingApi.getWorkItem(workItemId, ["System.Tags"], undefined, undefined, project);
    const currentTagsStr = (workItem.fields && (workItem.fields as any)["System.Tags"]) as string | undefined;
    const currentTags = new Set<string>((currentTagsStr || "")
      .split(";")
      .map(t => t.trim())
      .filter(t => t.length > 0));

    const existingProjectTags = await workItemTrackingApi.getTags(project);
    const projectTagSet = new Set<string>((existingProjectTags || []).map((t: any) => (t && t.name) ? String(t.name) : "").filter(Boolean));

    const toApply: string[] = [];
    for (const lbl of labels) {
      const name = typeof lbl === 'string' ? lbl.trim() : '';
      if (!name) continue;
      if (!currentTags.has(name)) {
        // If tag doesn't exist in project, adding it to the work item will create it implicitly
        if (!projectTagSet.has(name)) {
          console.log(`Tag '${name}' does not exist in project; it will be created by applying to work item ${workItemId}.`);
        }
        toApply.push(name);
      }
    }

    if (toApply.length === 0) return;

    // Merge and update the work item tags
    const updated = new Set<string>([...currentTags, ...toApply]);
    const newTagString = Array.from(updated).join("; ");

    await workItemTrackingApi.updateWorkItem(
      null,
      [
        {
          op: "add",
          path: "/fields/System.Tags",
          value: newTagString
        }
      ],
      workItemId,
      project
    );
    console.log(`Applied ${toApply.length} tag(s) to work item ${workItemId}: ${toApply.join(", ")}`);
  } catch (error) {
    console.error("Error ensuring labels on work item:", error);
    throw error;
  }
}

// Helper function to add a missing column tag to a work item
async function addMissingColumnTag(connection: azdev.WebApi, mapping: SyncMapping, workItemId: number, missingColumnName: string): Promise<void> {
  try {
    const workItemTrackingApi = await connection.getWorkItemTrackingApi();
    const project = mapping.azureDevOps.project;

    // Get current work item to read existing tags
    const workItem = await workItemTrackingApi.getWorkItem(workItemId, ["System.Tags"], undefined, undefined, project);
    const currentTagsStr = (workItem.fields && (workItem.fields as any)["System.Tags"]) as string | undefined;
    const currentTags = new Set<string>((currentTagsStr || "")
      .split(";")
      .map(t => t.trim())
      .filter(t => t.length > 0));

    // Add the missing column tag
    const missingColumnTag = `Missing destination column: ${missingColumnName}`;
    
    // Remove any existing "Missing destination column" tags to avoid duplicates
    const filteredTags = Array.from(currentTags).filter(tag => 
      !tag.startsWith("Missing destination column:")
    );
    
    filteredTags.push(missingColumnTag);
    const newTagString = filteredTags.join("; ");

    await workItemTrackingApi.updateWorkItem(
      null,
      [
        {
          op: "add",
          path: "/fields/System.Tags",
          value: newTagString
        }
      ],
      workItemId,
      project
    );
    
    console.log(`Added missing column tag to work item ${workItemId}: "${missingColumnTag}"`);
  } catch (error) {
    console.error(`Error adding missing column tag to work item ${workItemId}:`, error);
    throw error;
  }
}

// Helper function to update work item column position
async function updateWorkItemColumn(connection: azdev.WebApi, mapping: SyncMapping, workItemId: number | undefined, columnName: string | undefined): Promise<void> {
  if (!workItemId) {
    console.error("Work item ID is undefined");
    return;
  }

  if (!columnName) {
    console.error("Column name is undefined");
    return;
  }

  try {
    const workItemTrackingApi = await connection.getWorkItemTrackingApi();
    const project = mapping.azureDevOps.project;

    // Ensure the column exists in ADO, creating it if necessary
    const columnReady = await ensureBoardColumn(connection, mapping, columnName);
    
    if (!columnReady) {
      console.log(`Could not create column "${columnName}" in ADO board. Adding missing column tag.`);
      await addMissingColumnTag(connection, mapping, workItemId, columnName);
      return;
    }

    // Get the full work item to find the Kanban column field name
    const workItem = await workItemTrackingApi.getWorkItem(workItemId);

    // Find the Kanban column field (it contains "Kanban.Column" in the name)
    const boardColumnField = Object.keys(workItem.fields || {}).find(field =>
      field.includes("Kanban.Column") || field.includes("Board.Column")
    );

    if (boardColumnField) {
      console.log(`Found board column field: ${boardColumnField}`);
      
      // Check if work item is already in the target column
      const currentColumn = workItem.fields?.[boardColumnField];
      if (currentColumn === columnName) {
        console.log(`Work item ${workItemId} is already in column "${columnName}"`);
        return;
      }

      // Update the work item to move it to the correct column
      await workItemTrackingApi.updateWorkItem(
        null,
        [
          {
            op: "add",
            path: `/fields/${boardColumnField}`,
            value: columnName
          }
        ],
        workItemId,
        project
      );
      console.log(`Work item ${workItemId} moved from "${currentColumn}" to column "${columnName}" using field ${boardColumnField}`);
    } else {
      console.log("Could not find Kanban column field to update work item position");
      // Still add the missing column info as a tag for tracking
      await addMissingColumnTag(connection, mapping, workItemId, columnName);
    }
  } catch (error) {
    console.error(`Error updating work item ${workItemId} column to "${columnName}":`, error);
    // Add the missing column tag as fallback
    try {
      await addMissingColumnTag(connection, mapping, workItemId, columnName);
    } catch (tagError) {
      console.error("Failed to add missing column tag:", tagError);
    }
  }
}
