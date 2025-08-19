---
description: "Guidelines for writing Node.js and JavaScript code with Vitest testing"
applyTo: '**/*.js, **/*.mjs, **/*.cjs', '**/*.ts'
---

# Code Generation Guidelines

## Coding standards
- Use JavaScript / Typescript with ES2022 features and Node.js (20+) ESM modules
- Use Node.js built-in modules and avoid external dependencies where possible
- Always use async/await for asynchronous code, and use 'node:util' promisify function to avoid callbacks
- Keep the code simple and maintainable
- Use descriptive variable and function names
- Do not add comments unless absolutely necessary, the code should be self-explanatory
- Never use `null`, always use `undefined` for optional values
- Prefer functions over classes