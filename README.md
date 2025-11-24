# copy-over

> A GitHub App built with [Probot](https://github.com/probot/probot) that syncs GitHub Project boards with Azure DevOps work item boards

## Quick Start

### 1. Install the GitHub App

Install the app on your repository from the GitHub Marketplace or your organization's app settings.

### 2. Configure Sync

See [Configuration Guide](docs/CONFIGURATION.md) for detailed setup instructions.

Quick steps:
1. Create a new issue using the "Configure GitHub ↔ Azure DevOps Sync" template
2. Fill in your GitHub Project ID and Azure DevOps board details
3. Submit the issue - the app will automatically create the configuration

### 3. Start Using

Once configured, any changes to items in your GitHub Project will automatically sync to your Azure DevOps board:
- New items create new ADO work items
- Column moves update work item states
- Labels sync as tags

## Documentation

- [Configuration Guide](docs/CONFIGURATION.md) - Complete setup and configuration instructions
- [Column Sync Details](docs/COLUMN_SYNC.md) - How column synchronization works
- [Implementation Summary](docs/IMPLEMENTATION_SUMMARY.md) - Technical implementation details

## Development Setup

```sh
# Install dependencies
npm install

# Run the bot
npm start
```

## Docker

```sh
# 1. Build container
docker build -t copy-over .

# 2. Start container
docker run -e APP_ID=<app-id> -e PRIVATE_KEY=<pem-value> copy-over
```

## Features

### Current list

- Sync GitHub Project items (i.e. issues) to Azure DevOps boards. Bi-direction sync will not be supported.
- As you move a GitHub Project item between columns, the corresponding ADO work item state (e.g. column state) is updated.
- Labels are synced from Projects to ADO boards.
- If an item is synced to ADO, but that column names doesn't exist, it should add a label like: "Missing Column" to the work item in ADO.
- There's a one-to-one mapping between a Project and an ADO board. Setting this up is done via IssueOps. 
  - Ideally in the same repo, where the GitHub app code lives, users can create new issues following the GitHub issue template in `.github/ISSUE_TEMPLATE/configure-sync.yml`.
  - There they can fill out the required information to set up the sync (GitHub Project ID, ADO organization, project, team, board names).
  - Next, that will save a .json config file in `.github/copy-over-config.json` in the same repo. This file contains the mapping data between Projects and their mapped ADO boards. 
  - As the app listens for new webhook events, it will review this config file to determine how to determine if it's 1) a configured Project and 2) what ADO board to sync to.
  - This allows users to self-service their own configuration by simply creating an issue, and mapping is transparent in a central repo.
  - No secrets are stored in the config file - only mapping information.
  - Because this config file is version-controlled in the repo, users can see an audit trail of changes via Git history.
- 

## Remaining work

- [x] Current `undefined` column mapping issue when moving an issue to a new column that doesn't exist in ADO. Creating new columns in this case on ADO should be possible?
- [ ] Important, all comment history needs to be copied over. Need to figure out how to attribute authorship for comments.
- [ ] It should be possible to re-load the entire state of the Project to ADO board on-demand (e.g. via a special comment on an issue, or a separate "sync now" issue template). This would help with initial syncs or if something got out of sync.
