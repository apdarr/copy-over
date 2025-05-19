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

interface ProjectChanges {
  field_value: FieldValueChange;
}

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
      
      console.log("Field changed from:", fromValue);
      console.log("Field changed to:", toValue);
      
      // Get additional metadata
      const fieldName = changes.field_name || '';
      const fieldType = changes.field_type || '';
      const projectNumber = changes.project_number || '';
      
      console.log(`Field "${fieldName}" (${fieldType}) in project ${projectNumber} was updated`);
      
      // You can now use these variables for further processing
      if (fieldName === 'Status' && fieldType === 'single_select') {
        // Handle status field changes specifically
        console.log(`Status changed from "${fromValue}" to "${toValue}"`);
        
        // Example: Call a function to sync this change
        // syncStatusChange(fromValue, toValue, payload.projects_v2_item);
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
