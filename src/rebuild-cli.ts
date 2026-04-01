import { Probot } from "probot";
import { run } from "probot";
import {
  loadSyncConfig,
  createAdoConnection,
} from "./index.js";
import { reconcileProjectToBoard } from "./rebuild.js";
import myProbotApp from "./index.js";

async function rebuildAndStart() {
  const server = await run((app: Probot) => {
    app.onAny(async () => {});
  });

  const probot = (server as any).probotApp as Probot;
  const appOctokit = await probot.auth();

  const { data: installations } = await appOctokit.request("GET /app/installations");

  if (installations.length === 0) {
    console.error("No installations found for this GitHub App. Cannot rebuild.");
    process.exit(1);
  }

  console.log(`Found ${installations.length} installation(s). Running reconciliation for each...`);

  for (const installation of installations) {
    console.log(`\nProcessing installation ${installation.id} (${installation.account?.login ?? "unknown"})...`);

    const octokit = await probot.auth(installation.id);
    const config = await loadSyncConfig(octokit);

    if (!config || !config.syncMappings || config.syncMappings.length === 0) {
      console.log("No sync mappings configured. Skipping.");
      continue;
    }

    for (const mapping of config.syncMappings) {
      if (!mapping.enabled) {
        console.log(`Sync disabled for project #${mapping.githubProject.number}. Skipping.`);
        continue;
      }

      console.log(`Reconciling project #${mapping.githubProject.number} → ADO ${mapping.azureDevOps.organization}/${mapping.azureDevOps.project}...`);
      const connection = createAdoConnection(mapping);
      await reconcileProjectToBoard(octokit, connection, mapping);
    }
  }

  console.log("\n✅ Reconciliation complete. Loading webhook handlers...");
  await (server as any).load(myProbotApp);
  console.log("🚀 App is now listening for webhook events.");
}

rebuildAndStart().catch((error) => {
  console.error("Fatal error during rebuild:", error);
  process.exit(1);
});
