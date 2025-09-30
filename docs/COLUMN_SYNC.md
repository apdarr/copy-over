# Column Synchronization

This document explains how GitHub Projects columns are synchronized to Azure DevOps board columns.

## Overview

The service now automatically creates Azure DevOps board columns when they don't exist, ensuring that GitHub Projects structure is replicated in Azure DevOps.

## How It Works

### 1. Column Detection

When a GitHub Project item is created or moved to a column, the service:
- Extracts the column name from the GitHub webhook payload
- Checks if that column exists in the Azure DevOps board

### 2. Automatic Column Creation

If the column doesn't exist in Azure DevOps:
- The service creates a new column with the same name
- The column is configured with default settings:
  - **Type**: InProgress (can be customized)
  - **WIP Limit**: None (0)
  - **Split Columns**: Disabled (not split into Doing/Done)

### 3. Work Item Placement

After ensuring the column exists:
- New work items are created and placed in the correct column
- Existing work items are moved to match their GitHub Project status

## API Functions

### `checkColumnExists(columnName: string)`
Verifies if a column with the given name exists in the Azure DevOps board.

```typescript
const exists = await checkColumnExists("In Progress");
```

### `createBoardColumn(columnName: string)`
Creates a new column in the Azure DevOps board.

```typescript
const success = await createBoardColumn("In Progress");
```

### `ensureBoardColumn(columnName: string)`
Checks if a column exists, and creates it if it doesn't. This is the main function used throughout the codebase.

```typescript
const ready = await ensureBoardColumn("In Progress");
```

## Column Configuration

### Default Settings

New columns are created with these settings:

```typescript
{
  name: columnName,           // The column name from GitHub
  columnType: 1,              // InProgress type
  itemLimit: 0,               // No WIP limit
  isSplit: false,             // Not split into Doing/Done
  stateMappings: {}           // No automatic state mappings
}
```

### Column Types

Azure DevOps supports three column types:
- **0 (Incoming)**: Represents the backlog or incoming work
- **1 (InProgress)**: Work that is actively being worked on
- **2 (Outgoing)**: Completed work

The service uses type `1` (InProgress) by default for new columns.

### Customizing Column Settings

To customize how columns are created, modify the `createBoardColumn` function in `src/index.ts`:

```typescript
const newColumn = {
  name: columnName,
  columnType: 1,              // Change this: 0=Incoming, 1=InProgress, 2=Outgoing
  itemLimit: 5,               // Add WIP limit (0 = no limit)
  isSplit: true,              // Split into Doing/Done
  stateMappings: {            // Map work item states to this column
    "Active": columnName,
    "New": columnName
  }
};
```

## Error Handling

If column creation fails (due to permissions or API issues):
1. The service logs the error
2. A tag is added to the work item: `Missing destination column: <column-name>`
3. The work item is still created, but not placed in a specific column
4. You can manually review and fix these items by searching for the tag in Azure DevOps

## GitHub Project Column Names

The service recognizes these columns from your GitHub Project (defined in `STATUS_COLUMN_NAMES`):
- "Assigned by Sam"
- "Repeat Tasks"
- "Not Yet Started"
- "In Progress"
- "Done"

These columns will be automatically created in Azure DevOps if they don't exist.

## Permissions Required

To create columns, the Azure DevOps Personal Access Token (PAT) needs:
- **Work Items**: Read, Write, and Manage
- **Project and Team**: Read
- **Board Settings**: Write

## Azure DevOps Board Configuration

The service operates on:
- **Project**: ursa
- **Team**: ursa Team
- **Board**: Issues

To change these, modify the `teamContext` in the relevant functions:

```typescript
const teamContext = {
  project: "your-project",
  team: "your-team"
};
```

## Testing

To test column creation:

1. Create a new column in your GitHub Project
2. Add an issue to that column
3. Check the service logs for column creation messages
4. Verify the column appears in Azure DevOps board settings

## Troubleshooting

### Column not created
- Check PAT permissions in Azure DevOps
- Verify the board name is correct ("Issues")
- Check logs for API errors

### Work items not moving to columns
- Ensure columns are created first
- Check that the Kanban field exists on work items
- Verify team and project names are correct

### Column names with special characters
- Azure DevOps column names support most special characters
- Very long names (>256 characters) may be truncated
- Leading/trailing whitespace is automatically trimmed
