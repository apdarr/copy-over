# The big picture

This is a service that listens for changes GitHub Projects and syncs those to an Azure DevOps Board. It uses GitHub webhooks to receive real-time updates and the Azure DevOps REST API to make changes to the board.

The service utilizes a few key libraries: 
- Probot, for building GitHub Apps and handling webhooks
- `azure-devops-node-api` NPM package for abstracting away REST API calls to AzDo
- `@octokit/rest` NPM package for interacting with the GitHub REST API

# Coding standards
- Use JavaScript / Typescript with ES2022 features and Node.js (20+) ESM modules
- Use Node.js built-in modules and avoid external dependencies where possible
- Always use async/await for asynchronous code, and use 'node:util' promisify function to avoid callbacks
- Keep the code simple and maintainable
- Use descriptive variable and function names
- Do not add comments unless absolutely necessary, the code should be self-explanatory
- Never use `null`, always use `undefined` for optional values
- Prefer functions over classes