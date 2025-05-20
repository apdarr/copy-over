import { Probot } from "probot";
import * as azdev from "azure-devops-node-api";

// Define interfaces for the project field value change payload
interface FieldValueChange {
  field_node_id: string;
  field_type: string;
  field_name?: string;  // Make optional
  project_number?: number;  // Make optional
  from?: any;  // Make optional
  to?: any;    // Make optional
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

// Create a new work item
const workItemTrackingApi = await connection.getWorkItemTrackingApi();
const project = "ursa"; // Replace with your project name
const workItemType = "Issue"; // Replace with your work item type

export default (app: Probot) => {
  app.on("issues.opened", async (context) => {
    console.log("Issue context is ⭐", context);

    // Extract issue title
    const issueTitle: string = context.payload.issue.title || "";
    console.log("Issue title is 🔖", issueTitle);

    // Extract first comment
    const firstComment: string = context.payload.issue.body || "";
    console.log("First comment is 🐸", firstComment);
    
    sendToADO(issueTitle, firstComment);
  });

  app.on("projects_v2_item.edited", async (context) => {
    let payload = context.payload;
    console.log("Payload is 🐸", payload);
    
    // Extract from and to fields if they exist
    if (payload.changes && payload.changes.field_value) {
      const changes: FieldValueChange = payload.changes.field_value;
      
      const fromValue = changes.from || null;
      const toValue = changes.to || null;
      
      // console.log("Field changed from:", fromValue);
      // console.log("Field changed to:", toValue);
      
      // console.log("Field name is:::::::::", changes.field_name);
      
      // Get additional metadata
      const fieldName = changes.field_name || '';
      const fieldType = changes.field_type || '';
      // const projectNumber = changes.project_number || '';
      
      // console.log(`Field "${fieldName}" (${fieldType}) in project ${projectNumber} was updated`);
      
      // Check that that fromValue and toValue are not null and both exist in the STATUS_COLUMN_NAMES array
      if (fromValue && toValue && STATUS_COLUMN_NAMES.includes(fromValue.name) && STATUS_COLUMN_NAMES.includes(toValue.name)) {
        console.log(`Field "${fieldName}" (${fieldType}) changed from "${fromValue.name}" to "${toValue.name}"`);
        syncStatusChange(fromValue.name, toValue.name, payload.projects_v2_item);
      } else {
        console.log("Field change is not related to status columns or values are null");
      }
    }
  });

}

// Create a new function that sends the issueTitle and firstComment to ADO
async function sendToADO(issueTitle: string, firstComment: string) {
  // Construct the payload

  // Use azure-devops-node-api to send the payload to ADO
  const orgUrl = "https://dev.azure.com/ursa-minus";
  const token: string = process.env.ADO_TOKEN || '';

  const authHandler = azdev.getPersonalAccessTokenHandler(token);
  const connection = new azdev.WebApi(orgUrl, authHandler);

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

  // Fetch the name of columns within the board
  const workApi = await connection.getWorkApi();
  
  // Create a TeamContext object with project and team information
  const teamContext = {
    project: "ursa",
    team: "ursa Team"
  };

  // "board" is the name of your board from the screenshot

  const boards = await workApi.getBoards(teamContext);
  console.log("Boards: 🧪", boards);

  const boardColumns = await workApi.getBoardColumns(teamContext, "Issues");
  console.log("Board columns: ⚗️", boardColumns);

  // Example: Update the work item in ADO
  // await updateWorkItemInADO(item, toValue);
}
