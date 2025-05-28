import { Probot } from "probot";
import * as azdev from "azure-devops-node-api";

// Define interfaces for the project field value change payload
interface FieldValueChange {
  field_node_id: string;
  field_type: string;
  field_name?: string; // Make optional
  project_number?: number; // Make optional
  from?: any; // Make optional
  to?: any; // Make optional
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
}

// constant of Status column names
const STATUS_COLUMN_NAMES = [
  "Assigned by Sam",
  "Repeat Tasks",
  "Not Yet Started",
  "In Progress",
  "Done"
];

const orgUrl = "https://dev.azure.com/ursa-minus";
const token: string = process.env.ADO_TOKEN || '';

const authHandler = azdev.getPersonalAccessTokenHandler(token);
const connection = new azdev.WebApi(orgUrl, authHandler);

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
async function findExistingWorkItem(repoOwner: string, repoName: string, issueNumber: number): Promise<any | null> {
  try {
    const workItemTrackingApi = await connection.getWorkItemTrackingApi();
    const project = "ursa";
    
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

/**
 * Shared function to handle project item synchronization
 * Works for both creation and editing events
 */
async function handleProjectItemSync(context: any, item: any, targetColumn?: string): Promise<any> {
  console.log("=== handleProjectItemSync Debug ===");
  console.log("Item data:", JSON.stringify(item, null, 2));
  console.log("Target column:", targetColumn);
  
  // For project items, we need to fetch issue metadata using GraphQL
  if (!item.content_node_id) {
    console.log("No content_node_id found in project item");
    console.log("Available item keys:", Object.keys(item));
    return null;
  }

  console.log(`Found content_node_id: ${item.content_node_id}`);

  // Fetch issue metadata from GitHub
  const issueMetadata = await fetchIssueMetadata(context, item.content_node_id);
  if (!issueMetadata) {
    console.log("Could not fetch issue metadata from GitHub");
    return null;
  }

  const repoOwner = issueMetadata.repository.owner.login;
  const repoName = issueMetadata.repository.name;
  const issueNumber = issueMetadata.number;
  const issueTitle = issueMetadata.title;
  const issueBody = issueMetadata.body || "";

  console.log(`Processing GitHub issue: ${repoOwner}/${repoName}#${issueNumber} - ${issueTitle}`);

  // Check if work item already exists
  const existingWorkItem = await findExistingWorkItem(repoOwner, repoName, issueNumber);

  if (existingWorkItem) {
    console.log(`Found existing work item: ID ${existingWorkItem.id}`);
    
    // If targetColumn is specified, update the work item column
    if (targetColumn) {
      await updateWorkItemColumn(existingWorkItem.id, targetColumn);
    }
    
    return existingWorkItem;
  } else {
    console.log("Creating new work item...");
    
    // Create new work item
    const newWorkItem = await createWorkItem(
      issueTitle,
      issueBody,
      repoOwner,
      repoName,
      issueNumber,
      targetColumn
    );
    
    return newWorkItem;
  }
}

/**
 * Create a new work item in Azure DevOps
 */
async function createWorkItem(
  title: string,
  description: string,
  repoOwner: string,
  repoName: string,
  issueNumber: number,
  targetColumn?: string
): Promise<any> {
  const workItemTrackingApi = await connection.getWorkItemTrackingApi();
  const project = "ursa";
  const workItemType = "Issue";

  // Create GitHub identifier tag
  const githubIdentifier = `${repoOwner}/${repoName}#${issueNumber}`;
  
  let tags = `GitHub Import; ${githubIdentifier}`;
  if (targetColumn) {
    // Check if the target column exists in ADO board
    const boardHasColumn = await checkColumnExists(targetColumn);
    if (!boardHasColumn) {
      tags += `; Missing Column: ${targetColumn}`;
    }
  }

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
    if (targetColumn && await checkColumnExists(targetColumn)) {
      await updateWorkItemColumn(createdWorkItem.id!, targetColumn);
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
async function checkColumnExists(columnName: string): Promise<boolean> {
  try {
    const workApi = await connection.getWorkApi();
    const teamContext = {
      project: "ursa",
      team: "ursa Team"
    };

    const boardColumns = await workApi.getBoardColumns(teamContext, "Issues");
    const matchingColumn = boardColumns.find((col: any) => col.name === columnName);
    
    return !!matchingColumn;
  } catch (error) {
    console.error("Error checking if column exists:", error);
    return false;
  }
}

export default (app: Probot) => {
  // Handle project item creation - replaces issues.opened
  app.on("projects_v2_item.created", async (context) => {
    console.log("🆕 Project item created event received");
    
    const item = context.payload.projects_v2_item;
    
    // For creation events, we don't have initial column info in the payload
    // The item will be created and then moved to appropriate column via edit events
    console.log("Creating work item for newly added project item");
    
    await handleProjectItemSync(context, item);
  });

  // Handle project item edits - updated for streamlined logic
  app.on("projects_v2_item.edited", async (context) => {
    console.log("✏️ Project item edited event received");
    
    let payload = context.payload;
    const item = payload.projects_v2_item;

    // Extract from and to fields if they exist
    if (payload.changes && payload.changes.field_value) {
      const changes: FieldValueChange = payload.changes.field_value;

      const fromValue = changes.from || null;
      const toValue = changes.to || null;

      // Get additional metadata
      const fieldName = changes.field_name || '';
      const fieldType = changes.field_type || '';

      // Check that both values exist and are valid status columns
      if (fromValue && toValue && 
          STATUS_COLUMN_NAMES.includes(fromValue.name) && 
          STATUS_COLUMN_NAMES.includes(toValue.name)) {
        
        console.log(`Field "${fieldName}" (${fieldType}) changed from "${fromValue.name}" to "${toValue.name}"`);
        
        // Use the shared sync function with target column
        await handleProjectItemSync(context, item, toValue.name);
      } else {
        console.log("Field change is not related to status columns or values are null");
        
        // Even if it's not a status change, this might be the first time we see this item
        // (e.g., if the app was offline when the item was created)
        // Try to sync it without a specific target column
        await handleProjectItemSync(context, item);
      }
    } else {
      // No field changes detected, but still try to sync in case we missed the creation event
      console.log("No field value changes detected, attempting sync anyway");
      await handleProjectItemSync(context, item);
    }
  });
};

// Helper function to update work item column position
async function updateWorkItemColumn(workItemId: number | undefined, columnName: string | undefined): Promise<void> {
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
    const project = "ursa";

    // Get the full work item to find the Kanban column field name
    const workItem = await workItemTrackingApi.getWorkItem(workItemId);

    // Find the Kanban column field (it contains "Kanban.Column" in the name)
    const boardColumnField = Object.keys(workItem.fields || {}).find(field =>
      field.includes("Kanban.Column") || field.includes("Board.Column")
    );

    if (boardColumnField) {
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
      console.log(`Work item ${workItemId} moved to column ${columnName} using field ${boardColumnField}`);
    } else {
      console.log("Could not find Kanban column field to update work item position");
    }
  } catch (error) {
    console.error("Error updating work item column:", error);
    throw error;
  }
}
