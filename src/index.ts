import { Probot } from "probot";

export default (app: Probot) => {
  app.on("issues.opened", async (context) => {
    //const issueComment = context.issue({
    //  body: "Thanks for opening this issue!",
    //});
    console.log("Issue context is ⭐", context);
    //await context.octokit.issues.createComment(issueComment);

    // Extract issue title
    const issueTitle = context.payload.issue.title;
    console.log("Issue title is 🔖", issueTitle);

    // Extract first comment
    const firstComment = context.payload.issue.body;
    console.log("First comment is 🐸", firstComment);

    let myVar = "foobar";
  });
  // For more information on building apps:
  // https://probot.github.io/docs/

  // To get your app running against GitHub, see:
  // https://probot.github.io/docs/development/

  // Extract issue title

}