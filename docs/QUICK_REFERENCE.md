# Quick Reference Guide

## Configuration Commands (via Issues)

### Enable Sync
1. Create issue from template: **Configure GitHub ↔ Azure DevOps Sync**
2. Fill in all fields
3. Action: **Enable sync**
4. Submit

### Disable Sync
1. Create issue from template: **Configure GitHub ↔ Azure DevOps Sync**
2. Fill in current configuration
3. Action: **Disable sync**
4. Submit

### Update Configuration
1. Create issue from template: **Configure GitHub ↔ Azure DevOps Sync**
2. Fill in new values
3. Action: **Update configuration**
4. Submit

## Required Information

| Field | Example | Where to Find |
|-------|---------|---------------|
| GitHub Project Number | `3` | Project URL: `github.com/orgs/your-org/projects/3` |
| ADO Organization | `ursa-minus` | URL: `dev.azure.com/YOUR-ORG` |
| ADO Project | `ursa` | Your project name in ADO |
| ADO Team | `ursa Team` | Usually `[Project Name] Team` |
| ADO Board | `Issues` | Board name (usually `Issues` or `Stories`) |

## What Gets Synced

| GitHub | → | Azure DevOps |
|--------|---|--------------|
| Project Item | → | Work Item (Issue type) |
| Issue Title | → | Work Item Title |
| Issue Body | → | Work Item Description |
| Labels | → | Tags |
| Column | → | Board Column & State |
| Repository + Issue # | → | Tag: `owner/repo#123` |

## Common Workflows

### New Issue Flow
1. Create issue in GitHub
2. Add to GitHub Project
3. ✨ Auto-creates in ADO with `GitHub Import` tag

### Move Item Flow
1. Drag item to new column in GitHub Project
2. ✨ Auto-updates column in ADO
3. ✨ Auto-creates column in ADO if it doesn't exist

### Label Flow
1. Add/remove labels on GitHub issue
2. ✨ Auto-syncs as tags in ADO

## File Locations

| File | Purpose |
|------|---------|
| `.github/copy-over-config.json` | Active configuration |
| `.github/copy-over-config.example.json` | Example configuration |
| `.github/ISSUE_TEMPLATE/configure-sync.yml` | Configuration form template |

## Troubleshooting Quick Checks

### Sync not working?
- [ ] Check `.github/copy-over-config.json` exists
- [ ] Verify `enabled: true` in config
- [ ] Confirm GitHub App is installed
- [ ] Check `ADO_TOKEN` environment variable
- [ ] Review GitHub App logs

### Configuration issue failed?
- [ ] Verify issue has `sync-config` label
- [ ] Check all required fields are filled
- [ ] Validate GitHub Project ID format
- [ ] Review issue comments for errors

### Work item not created?
- [ ] Verify item has `content_node_id` (not a draft)
- [ ] Check item is linked to an issue/PR
- [ ] Review GitHub App webhook logs
- [ ] Verify ADO permissions

## Security Notes

### Stored in Config ✅
- GitHub Project ID
- ADO organization, project, team, board names
- Sync enabled/disabled flag

### NOT Stored ❌
- Authentication tokens
- Personal access tokens
- Any secrets

### Best Practices
- Keep repository private if org structure is sensitive
- Enable branch protection on `main`
- Use CODEOWNERS for config file reviews
- Audit configuration changes via Git history

## Support

- [Full Configuration Guide](CONFIGURATION.md)
- [Column Sync Details](COLUMN_SYNC.md)
- [Demo Script](DEMO_SCRIPT.md)
- [Implementation Summary](IMPLEMENTATION_SUMMARY.md)
