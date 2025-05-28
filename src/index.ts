import { Probot } from "probot";
import * as azdev from "azure-devops-node-api";

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
 * Extract current column from project item field values
 */
function extractCurrentColumn(item: any): string | undefined {
  // Check if we have field_values in the payload
  if (item.field_values && Array.isArray(item.field_values)) {
    for (const fieldValue of item.field_values) {
      // Look for single_select field values that match our status columns
      if (fieldValue.field && fieldValue.field.name && 
          fieldValue.option_name && STATUS_COLUMN_NAMES.includes(fieldValue.option_name)) {
        console.log(`Found current column in payload: ${fieldValue.option_name}`);
        return fieldValue.option_name;
      }
    }
  }

  // Also check if field values are nested differently
  if (item.fieldValues && item.fieldValues.nodes) {
    for (const fieldValue of item.fieldValues.nodes) {
      if (fieldValue.field && fieldValue.field.name && 
          fieldValue.name && STATUS_COLUMN_NAMES.includes(fieldValue.name)) {
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
async function handleProjectItemSync(context: any, item: any, eventTargetColumn?: string): Promise<any> {
  console.log("=== handleProjectItemSync START ===");
  // console.log("Item data (full):", JSON.stringify(item, null, 2)); // Verbose: log full item if needed
  console.log("Item content_node_id:", item.content_node_id);
  console.log("Initial eventTargetColumn (from edit event, if any):", eventTargetColumn);

  if (!item.content_node_id) {
    console.log("Item does not have a content_node_id (e.g., draft issue). Skipping sync.");
    return null;
  }

  const issueMetadata = await fetchIssueMetadata(context, item.content_node_id);
  if (!issueMetadata) {
    console.log("Could not fetch issue metadata from GitHub. Skipping sync.");
    return null;
  }

  const { title: issueTitle, body: issueBody = "", number: issueNumber } = issueMetadata;
  const { login: repoOwner } = issueMetadata.repository.owner;
  const { name: repoName } = issueMetadata.repository;
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

  const existingWorkItem = await findExistingWorkItem(repoOwner, repoName, issueNumber);

  if (existingWorkItem) {
    console.log(`Found existing ADO Work Item ID: ${existingWorkItem.id} for ${githubIdentifier}`);
    if (finalTargetColumn) {
      // Check if the ADO column field for the existing work item already matches finalTargetColumn
      // This requires knowing the specific field name, e.g., workItem.fields["WEF_..._Kanban.Column"]
      // For simplicity, we'll attempt the update, ADO API might be idempotent or we can add a check later.
      console.log(`Attempting to update column for existing work item ${existingWorkItem.id} to "${finalTargetColumn}"`);
      await updateWorkItemColumn(existingWorkItem.id, finalTargetColumn); // updateWorkItemColumn internally checks if column exists
    } else {
      console.log(`No specific target column determined for existing work item ${existingWorkItem.id}. No column update performed.`);
    }
    return existingWorkItem;
  } else {
    console.log(`No existing ADO Work Item found for ${githubIdentifier}. Creating new one.`);
    const newWorkItem = await createWorkItem(
      issueTitle,
      issueBody,
      repoOwner,
      repoName,
      issueNumber,
      finalTargetColumn // createWorkItem internally handles if column exists and tags if missing
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
  app.on("projects_v2_item.created", async (context) => {
    console.log("🆕 Project item created event received");
    const item = context.payload.projects_v2_item;
    // For 'created' events, eventTargetColumn is undefined.
    // handleProjectItemSync will try to extract the column from the item's current field values.
    await handleProjectItemSync(context, item);
  });

  app.on("projects_v2_item.edited", async (context) => {
    console.log("✏️ Project item edited event received");
    const payload = context.payload;
    const item = payload.projects_v2_item; // This is the full state of the item *after* the edit.
    let determinedTargetColumn: string | undefined = undefined;

    // Check if the edit involved a change to a field value we care about (i.e., status column)
    if (payload.changes && payload.changes.field_value && 
        typeof payload.changes.field_value === 'object' && payload.changes.field_value !== null) {
      
      const fieldValChange = payload.changes.field_value as any; // Use 'as any' for flexibility, or a more specific type

      // We are interested if 'field_name' is 'Status' (or whatever your project calls it)
      // and if 'to' (the new value) has a 'name' property that's a recognized column.
      // The exact structure of field_value can vary based on the field type.
      // For a single select field (like a status column), 'to' would be an object with a 'name'.
      if (fieldValChange.field_type === 'single_select' && 
          fieldValChange.to && typeof fieldValChange.to === 'object' && 
          typeof fieldValChange.to.name === 'string' && 
          STATUS_COLUMN_NAMES.includes(fieldValChange.to.name)) {
        
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
    await handleProjectItemSync(context, item, determinedTargetColumn);
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
