# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
