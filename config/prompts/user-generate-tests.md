{{#if hasGaps}}
## Gap-Only Generation Mode

Generate {{testType}} tests ONLY for these specific coverage gaps:

{{#each testGaps}}
{{@index}}. **File**: `{{this.file}}` ({{this.type}})
   - Priority: {{this.priority}}
   - Reason: {{this.reason}}
   {{#if this.endpoint}}- Endpoint: {{this.endpoint}}{{/if}}
   {{#if this.route}}- Route: {{this.route}}{{/if}}
{{/each}}

IMPORTANT: Generate tests ONLY for the items listed above. Do NOT create tests for files/routes already covered.

{{else}}
## Full Coverage Generation Mode

Generate comprehensive {{testType}} tests for the entire application to achieve 95%+ coverage.
Analyze the codebase structure and create tests for ALL:
- Controllers/Routes (every endpoint, every HTTP method)
- Services/Business Logic (every function, every branch)
- Models/Schemas (validation, relationships, methods)
- Middleware (auth, error handling, validation)
- Utilities/Helpers (every exported function)

{{/if}}

{{#if existingTestContext}}
## ⚠️ EXISTING TESTS DETECTED — DO NOT REGENERATE!

There are **{{existingTestContext.totalExistingTests}}** existing test file(s):
{{#each existingTestContext.existingFiles}}
- `{{this}}`
{{/each}}

{{existingTestContext.instruction}}

**Rules for Extension:**
1. Use the SAME coding style, patterns, and conventions as existing tests
2. Use the SAME file naming convention
3. ONLY generate NEW test cases that don't already exist
4. Focus on: untested branches, edge cases, error handling, NFR scenarios
5. DO NOT duplicate any existing test case names or scenarios
6. If a source file is already well-tested, skip it entirely

{{/if}}

{{#if appDocumentation}}
## Application Documentation Context

{{#if appDocumentation.edgeCases}}
### Edge Cases to Test (MANDATORY):
{{#each appDocumentation.edgeCases}}
- [{{this.category}}] {{this.scenario}} → Expected: {{this.expectedBehavior}}
{{/each}}
{{/if}}

{{#if appDocumentation.nfrScenarios}}
### NFR Scenarios:
{{#each appDocumentation.nfrScenarios}}
- [{{this.category}}] {{this.scenario}} (Metric: {{this.metric}})
{{/each}}
{{/if}}

{{#if appDocumentation.securityConsiderations}}
### Security Tests:
{{#each appDocumentation.securityConsiderations}}
- {{this}}
{{/each}}
{{/if}}

{{#if appDocumentation.errorScenarios}}
### Error Handling Tests:
{{#each appDocumentation.errorScenarios}}
- {{this.scenario}}: Expected → {{this.expectedBehavior}}
{{/each}}
{{/if}}

{{#if appDocumentation.businessRules}}
### Business Rules to Validate:
{{#each appDocumentation.businessRules}}
- {{this.rule}} (Context: {{this.context}})
{{/each}}
{{/if}}
{{/if}}

{{#if chunkInfo}}
## Chunked Generation

This is **Chunk "{{chunkInfo.name}}"** with {{chunkInfo.totalScenarios}} scenarios.
Generate ONLY tests for the specific scenarios/routes/endpoints provided below.
Do NOT generate placeholder or generic tests — be specific and comprehensive.
{{/if}}
