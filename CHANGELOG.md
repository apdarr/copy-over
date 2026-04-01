# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Comment Syncing**: GitHub issue comments are now synced to ADO work item discussions
  - Attribution format: original comment followed by `— @username via copy-over`
  - Real-time sync via `issue_comment.created` webhook
  - Backfill of existing comments when work items are created or updated
  - Duplicate prevention using hidden HTML markers (`<!-- gh-comment-id:XXX -->`)
  - Bot comments are automatically skipped to prevent sync loops
  - Comment logic extracted to dedicated `src/comments.ts` module

- **Deletion Sync**: Removing an item from the GitHub Project now deletes the corresponding ADO work item via `projects_v2_item.deleted` webhook handler.

- **On-Demand Reconciliation** (`npm run rebuild`): Full diff-based sync between GitHub Project and ADO board.
  - Fetches all items from GitHub Project via paginated GraphQL
  - Fetches all synced ADO work items by `GitHub Import` tag
  - Creates missing items, deletes orphaned items, updates column/labels for existing items
  - After reconciliation, continues listening for webhook events normally
  - Reconciliation logic in `src/rebuild.ts`, CLI entry point in `src/rebuild-cli.ts`

### Fixed
- **Duplicate work item creation**: When adding an item to a project column, GitHub fires both `created` and `edited` events simultaneously. Both handlers would race to create a work item, resulting in duplicates (one in "To Do", one in the correct column). Added per-item processing lock to serialize concurrent handlers on the same project item.
- **Comment formatting in ADO**: Comments now use HTML `<br>` tags instead of `\n` for line breaks, since ADO renders comments as HTML.

- **IssueOps Configuration System**: Configure sync via GitHub issue forms
  - Issue template for configuration at `.github/ISSUE_TEMPLATE/configure-sync.yml`
  - Automatic parsing and storage of configuration
  - Support for enable/disable/update actions
  
- **Dynamic Configuration Loading**: 
  - Configuration stored in `.github/copy-over-config.json`
  - Per-repository configuration support
  - No hardcoded Azure DevOps credentials
  - Configuration validation and error handling

- **Enhanced Documentation**:
  - Comprehensive configuration guide (`docs/CONFIGURATION.md`)
  - Demo script for client presentations (`docs/DEMO_SCRIPT.md`)
  - Quick reference guide (`docs/QUICK_REFERENCE.md`)
  - Example configuration file

- **Security Features**:
  - Configuration file version-controlled in repository
  - No secrets stored in configuration
  - Support for branch protection workflows
  - Audit trail via Git history

### Changed
- Refactored all Azure DevOps helper functions to accept dynamic configuration
- Updated app permissions to include `contents: write` for config file management
- Made Azure DevOps connection creation dynamic based on config
- Updated README with feature highlights and documentation links

### Technical Details
- Functions now accept `SyncConfig` and `WebApi` connection parameters
- Configuration loaded once per webhook event
- Sync can be enabled/disabled without losing configuration
- Each repository maintains independent configuration

## [Previous Versions]

### Column Synchronization
- Automatic column creation in Azure DevOps
- Column state mapping
- Label synchronization as tags
- GitHub identifier tracking via tags
- Duplicate work item prevention
