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

export default (app: Probot) => {
  app.on("issues.opened", async (context) => {
    // Extract issue title
    const issueTitle: string = context.payload.issue.title || "";

    // Extract first comment
    const firstComment: string = context.payload.issue.body || "";

    sendToADO(issueTitle, firstComment);
  });

  app.on("projects_v2_item.edited", async (context) => {
    let payload = context.payload;

    // Extract from and to fields if they exist
    if (payload.changes && payload.changes.field_value) {
      const changes: FieldValueChange = payload.changes.field_value;

      const fromValue = changes.from || null;
      const toValue = changes.to || null;

      // Get additional metadata
      const fieldName = changes.field_name || '';
      const fieldType = changes.field_type || '';

      // Check that that fromValue and toValue are not null and both exist in the STATUS_COLUMN_NAMES array
      if (fromValue && toValue && STATUS_COLUMN_NAMES.includes(fromValue.name) && STATUS_COLUMN_NAMES.includes(toValue.name)) {
        console.log(`Field "${fieldName}" (${fieldType}) changed from "${fromValue.name}" to "${toValue.name}"`);
        syncStatusChange(fromValue.name, toValue.name, payload.projects_v2_item);
      } else {
        console.log("Field change is not related to status columns or values are null");
      }
    }
  });
};

async function sendToADO(issueTitle: string, firstComment: string) {
  // Create a new work item
  const workItemTrackingApi = await connection.getWorkItemTrackingApi();
  const project = "ursa"; // Replace with your project name
  const workItemType = "Issue"; // Replace with your work item type

  // Define the work item fields
  const patchDocument = [
    {
      op: "add",
      path: "/fields/System.Title",
      value: issueTitle
    },
    {
      op: "add",
      path: "/fields/System.Description",
      value: firstComment
    },
    // Add other fields as needed
    {
      op: "add",
      path: "/fields/System.Tags",
      value: "GitHub Import"
    }
  ];

  try {
    // Create the work item
    const createdWorkItem = await workItemTrackingApi.createWorkItem(
      null, // No template
      patchDocument,
      project,
      workItemType
    );

    console.log(`Work item created: ID ${createdWorkItem.id}`);
    return createdWorkItem;
  } catch (error) {
    console.error("Error creating work item:", error);
    throw error;
  }
}

async function syncStatusChange(fromValue: string, toValue: string, item: any) {
  // Implement your logic to sync the status change
  console.log(`🧪 Syncing status change from "${fromValue}" to "${toValue}" for item ${item} 🧪`);
  console.log("GitHub item data:", item);

  // Fetch the name of columns within the board
  const workApi = await connection.getWorkApi();

  // Create a TeamContext object with project and team information
  const teamContext = {
    project: "ursa",
    team: "ursa Team"
  };

  const boards = await workApi.getBoards(teamContext);
  console.log("Boards: 🧪", boards);

  const boardColumns = await workApi.getBoardColumns(teamContext, "Issues");
  console.log("Board columns: ⚗️", boardColumns);

  // Compare the toValue with the boardColumns object
  const matchingColumn = boardColumns.find((col: any) => col.name === toValue);

  // if we find a matching column in the target ADO board, then move the item to that column
  if (matchingColumn) {
    console.log(`Found matching column in ADO: ${matchingColumn.name} (ID: ${matchingColumn.id})`);
    const matchingColumnName = matchingColumn.name;
    // Get work item data from the GitHub item
    const workItemTitle = item.title || "GitHub Issue";
    const workItemDescription = item.content || "No description provided";

    // Create a new work item
    const workItemTrackingApi = await connection.getWorkItemTrackingApi();
    const project = "ursa";
    const workItemType = "Issue";

    // Define the work item fields with column information
    const patchDocument = [
      {
        op: "add",
        path: "/fields/System.Title",
        value: workItemTitle
      },
      {
        op: "add",
        path: "/fields/System.Description",
        value: workItemDescription
      },
      {
        op: "add",
        path: "/fields/System.Tags",
        value: "GitHub Import"
      }
    ];

    try {
      // Create the work item
      const createdWorkItem = await workItemTrackingApi.createWorkItem(
        null, // No template
        patchDocument,
        project,
        workItemType
      );

      console.log(`Work item created: ID ${createdWorkItem.id}`);

      // Get the full work item to find the Kanban column field name
      const workItem = await workItemTrackingApi.getWorkItem(createdWorkItem.id!);

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
              value: matchingColumnName
            }
          ],
          createdWorkItem.id!,
          project
        );
        console.log(`Work item moved to column ${matchingColumnName} using field ${boardColumnField}`);
      } else {

        console.log("Could not find Kanban column field to update work item position");
      }

      return createdWorkItem;
    } catch (error) {
      console.error("Error creating work item:", error);
      throw error;
    }
  } else {
    console.log(`No matching column found for "${toValue}" in ADO board.`);
    console.log(`⚠️  Azure DevOps API does not support creating board columns programmatically.`);
    console.log(`📝 Please manually create a column named "${toValue}" in the Azure DevOps board to enable sync for this status.`);
    
    // Still create the work item, but it will go to the default column
    try {
      const workItemTitle = item.title || "GitHub Issue";
      const workItemDescription = item.content || "No description provided";

      // Create a new work item
      const workItemTrackingApi = await connection.getWorkItemTrackingApi();
      const project = "ursa";
      const workItemType = "Issue";

      // Define the work item fields
      const patchDocument = [
        {
          op: "add",
          path: "/fields/System.Title",
          value: workItemTitle
        },
        {
          op: "add",
          path: "/fields/System.Description",
          value: workItemDescription
        },
        {
          op: "add",
          path: "/fields/System.Tags",
          value: `GitHub Import; Missing Column: ${toValue}`
        }
      ];

      // Create the work item
      const createdWorkItem = await workItemTrackingApi.createWorkItem(
        null, // No template
        patchDocument,
        project,
        workItemType
      );

      console.log(`Work item created: ID ${createdWorkItem.id} (placed in default column due to missing "${toValue}" column)`);
      return createdWorkItem;
    } catch (error) {
      console.error("Error creating work item:", error);
      throw error;
    }
  }
}
