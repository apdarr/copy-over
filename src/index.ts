import { Probot } from "probot";
import * as azdev from "azure-devops-node-api";
import { send } from "process";


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
