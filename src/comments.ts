import * as azdev from "azure-devops-node-api";

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

interface GitHubComment {
  id: number;
  body: string;
  user: {
    login: string;
  };
  created_at: string;
  updated_at: string;
}

const COMMENT_MARKER_PREFIX = "<!-- gh-comment-id:";
const COMMENT_MARKER_SUFFIX = " -->";

export function formatCommentForAdo(body: string, authorLogin: string): string {
  const trimmedBody = body.trim();
  return `${trimmedBody}\n\n— @${authorLogin} via copy-over`;
}

export function buildCommentMarker(githubCommentId: number): string {
  return `${COMMENT_MARKER_PREFIX}${githubCommentId}${COMMENT_MARKER_SUFFIX}`;
}

export function extractCommentMarker(adoCommentText: string): number | undefined {
  const match = adoCommentText.match(/<!-- gh-comment-id:(\d+) -->/);
  if (match) {
    const id = parseInt(match[1], 10);
    return isNaN(id) ? undefined : id;
  }
  return undefined;
}

export async function fetchIssueComments(
  context: any,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<GitHubComment[]> {
  try {
    const comments: GitHubComment[] = [];
    const perPage = 100;
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const { data } = await context.octokit.issues.listComments({
        owner,
        repo,
        issue_number: issueNumber,
        per_page: perPage,
        page,
      });

      comments.push(
        ...data.map((c: any) => ({
          id: c.id,
          body: c.body || "",
          user: { login: c.user?.login || "unknown" },
          created_at: c.created_at,
          updated_at: c.updated_at,
        }))
      );

      hasMore = data.length === perPage;
      page++;
    }

    console.log(
      `Fetched ${comments.length} comment(s) for ${owner}/${repo}#${issueNumber}`
    );
    return comments;
  } catch (error) {
    console.error(
      `Error fetching comments for ${owner}/${repo}#${issueNumber}:`,
      error
    );
    return [];
  }
}

async function getExistingSyncedCommentIds(
  connection: azdev.WebApi,
  project: string,
  workItemId: number
): Promise<Set<number>> {
  const syncedIds = new Set<number>();

  try {
    const workItemTrackingApi = await connection.getWorkItemTrackingApi();
    const comments = await workItemTrackingApi.getComments(project, workItemId);

    if (comments?.comments) {
      for (const comment of comments.comments) {
        const text = comment.text || "";
        const ghId = extractCommentMarker(text);
        if (ghId !== undefined) {
          syncedIds.add(ghId);
        }
      }
    }
  } catch (error) {
    console.error(
      `Error fetching existing ADO comments for work item ${workItemId}:`,
      error
    );
  }

  return syncedIds;
}

export async function syncCommentsToWorkItem(
  connection: azdev.WebApi,
  mapping: SyncMapping,
  workItemId: number,
  comments: GitHubComment[]
): Promise<number> {
  if (comments.length === 0) return 0;

  const project = mapping.azureDevOps.project;

  const alreadySynced = await getExistingSyncedCommentIds(
    connection,
    project,
    workItemId
  );

  const toSync = comments.filter((c) => !alreadySynced.has(c.id));

  if (toSync.length === 0) {
    console.log(
      `All ${comments.length} comment(s) already synced to work item ${workItemId}`
    );
    return 0;
  }

  console.log(
    `Syncing ${toSync.length} new comment(s) to work item ${workItemId}`
  );

  const workItemTrackingApi = await connection.getWorkItemTrackingApi();
  let syncedCount = 0;

  for (const comment of toSync) {
    try {
      const formattedBody = formatCommentForAdo(comment.body, comment.user.login);
      const marker = buildCommentMarker(comment.id);
      const fullText = `${formattedBody}\n\n${marker}`;

      await workItemTrackingApi.addComment(
        { text: fullText },
        project,
        workItemId
      );

      syncedCount++;
      console.log(
        `Synced comment ${comment.id} by @${comment.user.login} to work item ${workItemId}`
      );
    } catch (error) {
      console.error(
        `Error syncing comment ${comment.id} to work item ${workItemId}:`,
        error
      );
    }
  }

  console.log(
    `Successfully synced ${syncedCount}/${toSync.length} comment(s) to work item ${workItemId}`
  );
  return syncedCount;
}
