# Configuration Setup Guide

This guide will help you configure the GitHub ↔ Azure DevOps sync using IssueOps.

## Prerequisites

1. The GitHub App must be installed on your repository
2. You need the Azure DevOps Personal Access Token configured as `ADO_TOKEN` environment variable
3. The repository should have branch protection on `main` to prevent unauthorized config changes

## Setup Steps

### 1. Create Configuration Issue

1. Go to your repository's Issues tab
2. Click **New Issue**
3. Select **Configure GitHub ↔ Azure DevOps Sync** template
4. Fill in the required information:
   - **GitHub Project Number**: The project number from your project URL
     - To find this: Look at your project URL (e.g., `github.com/orgs/your-org/projects/3`) - the number is `3`
   - **Azure DevOps Organization**: Your ADO organization name (from `dev.azure.com/YOUR-ORG`)
   - **Azure DevOps Project**: The project name within your organization
   - **Azure DevOps Team**: The team name (usually `[Project] Team`)
   - **Azure DevOps Board Name**: The board to sync to (usually `Issues` or `Stories`)
   - **Action**: Select `Enable sync`

5. Submit the issue

### 2. Automatic Configuration

The GitHub App will:
- Parse the issue form data
- Create/update `.github/copy-over-config.json` in your repository
- Comment on the issue with the result
- Close the issue automatically

### 3. Configuration File

The configuration is stored in `.github/copy-over-config.json`:

```json
{
  "syncConfig": {
    "githubProjectNumber": 3,
    "azureDevOps": {
      "organization": "ursa-minus",
      "project": "ursa",
      "team": "ursa Team",
      "board": "Issues"
    },
    "enabled": true
  }
}
```

**Note**: This file will be committed to your repository. Make sure your repository is private if you're concerned about exposing organizational structure (though the information stored is typically not sensitive).

## Managing Configuration

### Update Configuration

1. Create a new issue with the **Configure GitHub ↔ Azure DevOps Sync** template
2. Select **Update configuration** as the action
3. Fill in the new values
4. Submit the issue

### Disable Sync

1. Create a new issue with the **Configure GitHub ↔ Azure DevOps Sync** template
2. Select **Disable sync** as the action
3. Submit the issue

This will set `enabled: false` in the configuration without removing it.

### Re-enable Sync

Follow the same process as "Update Configuration" and select **Enable sync**.

## Security Considerations

### What's Stored in the Config File

- GitHub Project ID (public information)
- Azure DevOps organization, project, team, and board names
- Sync enabled/disabled flag

### What's NOT Stored

- No authentication tokens
- No secrets
- No personal access tokens

### Recommended Security Measures

1. **Private Repository**: Keep the repository private if organizational structure is sensitive
2. **Branch Protection**: Enable branch protection on `main` to require PR reviews
3. **CODEOWNERS**: Add a `CODEOWNERS` file to require specific reviewers for config changes:
   ```
   .github/copy-over-config.json @your-team
   ```

## Troubleshooting

### Configuration Not Applied

1. Check that the issue has the `sync-config` label
2. Verify the GitHub App has `contents: write` permission
3. Check the issue comments for error messages

### Sync Not Working

1. Verify the configuration file exists: `.github/copy-over-config.json`
2. Check that `enabled: true` in the configuration
3. Verify the `ADO_TOKEN` environment variable is set correctly
4. Check the GitHub App logs for detailed error messages

### Configuration File Format Errors

If you manually edit the configuration file and introduce errors:
1. The sync will stop working
2. Create a new configuration issue to regenerate a valid file
3. Or manually fix the JSON syntax errors

## Example Configuration

See `.github/copy-over-config.example.json` for a complete example configuration.

## One-to-One Mapping

**Important**: This integration only supports a **1:1 relationship** between:
- One GitHub Project Board ↔ One Azure DevOps Board

You cannot sync:
- Multiple GitHub Projects to one ADO board
- One GitHub Project to multiple ADO boards

Each repository should have one configuration for one project-to-board sync.
