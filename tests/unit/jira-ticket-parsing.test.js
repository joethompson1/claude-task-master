/**
 * Tests for JiraTicket parsing functionality
 * These tests verify proper separation of content into description vs structured panels
 */

import { JiraTicket } from '../../mcp-server/src/core/utils/jira-ticket.js';

describe('JiraTicket Parsing', () => {
  describe('parseStructuredDescription', () => {
    test('should separate main description from structured sections', () => {
      const fullDescription = `Implement intelligent context retrieval that combines Jira ticket relationships with Bitbucket Pull Request data to provide comprehensive context for AI-assisted task planning and development decisions.

## Current Problem

When Taskmaster MCP retrieves Jira tickets via get_jira_task, get_jira_tasks, or next_jira_task tools, the LLM operates with limited context - only seeing isolated ticket information. This leads to:

- Duplicate work and conflicting implementations
- Missing dependencies on related work
- Lack of awareness of existing solutions in linked PRs
- Suboptimal task breakdown without understanding prior approaches

## Solution Overview

Implement a Hybrid Smart Retrieval system that intelligently combines:
1. Jira Relationship Traversal for immediate hierarchical context
2. Bitbucket Integration for actual implementation details and outcomes
3. Semantic Enhancement (optional future phase) for broader context discovery

## Implementation Details

### Phase 1: Foundation Infrastructure

#### 1.1 Bitbucket API Client Setup

File: \`mcp-server/src/core/utils/bitbucket-client.js\`
- Create new client similar to existing \`jira-client.js\` pattern
- Environment variables: \`BITBUCKET_WORKSPACE\`, \`BITBUCKET_USERNAME\`, \`BITBUCKET_APP_PASSWORD\`
- Authentication via Basic Auth (username + app password)
- Support for: \`GET /repositories/{workspace}/{repo}/pullrequests\`, \`GET /repositories/{workspace}/{repo}/pullrequests/{id}/diffstat\`

#### 1.2 Relationship Resolver Service

File: \`mcp-server/src/core/utils/jira-relationship-resolver.js\`
- Leverage existing \`issuelinks\` and \`subtasks\` fields already fetched in \`jira-client.js\`
- Traverse relationships up to 2 levels deep: parent/child, epic/story, dependencies, "relates to"
- Use existing JQL search patterns from \`jira-utils.js\` fetchTasksFromJira function
- Return structured relationship graph with metadata

## Acceptance Criteria

### Phase 1: Foundation (Must Have)
- [ ] Bitbucket API client successfully authenticates and fetches PRs
- [ ] Jira relationship resolver traverses parent/child, epic/story, issuelinks up to 2 levels
- [ ] Ticket-PR matching identifies linked PRs via commit messages and branch names
- [ ] All components handle authentication failures and API rate limits gracefully

### Phase 2: Context Aggregation (Must Have)
- [ ] Context aggregator combines Jira and Bitbucket data into structured format
- [ ] Intelligent filtering prioritizes recent work (6 months), completed PRs, and relevant relationships
- [ ] Error handling maintains functionality when Bitbucket is unavailable

## Test Strategy

### Unit Testing
- Bitbucket Client: Mock API responses, test authentication, error handling
- Relationship Resolver: Test traversal logic with various ticket hierarchies
- PR Matcher: Test pattern matching with different commit/branch formats
- Context Aggregator: Test data combination and filtering logic

### Integration Testing
- Enhanced MCP Tools: Test full context retrieval flow with real Jira/Bitbucket data
- Backward Compatibility: Ensure existing tool functionality unchanged
- Error Scenarios: Test graceful degradation when Bitbucket unavailable`;

      const sections = JiraTicket.parseStructuredDescription(fullDescription);

      // Main description should contain only the opening paragraphs before structured sections
      expect(sections.description).toBe(`Implement intelligent context retrieval that combines Jira ticket relationships with Bitbucket Pull Request data to provide comprehensive context for AI-assisted task planning and development decisions.

## Current Problem

When Taskmaster MCP retrieves Jira tickets via get_jira_task, get_jira_tasks, or next_jira_task tools, the LLM operates with limited context - only seeing isolated ticket information. This leads to:

- Duplicate work and conflicting implementations
- Missing dependencies on related work
- Lack of awareness of existing solutions in linked PRs
- Suboptimal task breakdown without understanding prior approaches

## Solution Overview

Implement a Hybrid Smart Retrieval system that intelligently combines:
1. Jira Relationship Traversal for immediate hierarchical context
2. Bitbucket Integration for actual implementation details and outcomes
3. Semantic Enhancement (optional future phase) for broader context discovery`);

      // Implementation details should include the header and all content
      expect(sections.details).toContain('## Implementation Details');
      expect(sections.details).toContain('### Phase 1: Foundation Infrastructure');
      expect(sections.details).toContain('#### 1.1 Bitbucket API Client Setup');
      expect(sections.details).toContain('File: `mcp-server/src/core/utils/bitbucket-client.js`');

      // Acceptance criteria should include the header and all content
      expect(sections.acceptanceCriteria).toContain('## Acceptance Criteria');
      expect(sections.acceptanceCriteria).toContain('### Phase 1: Foundation (Must Have)');
      expect(sections.acceptanceCriteria).toContain('- [ ] Bitbucket API client successfully authenticates');

      // Test strategy should include the header and all content
      expect(sections.testStrategy).toContain('## Test Strategy');
      expect(sections.testStrategy).toContain('### Unit Testing');
      expect(sections.testStrategy).toContain('### Integration Testing');
    });

    test('should handle content with different header levels', () => {
      const fullDescription = `Main description paragraph.

# Implementation Details

Some implementation content here.

# Acceptance Criteria

Some criteria here.

# Test Strategy

Some test strategy here.`;

      const sections = JiraTicket.parseStructuredDescription(fullDescription);

      expect(sections.description).toBe('Main description paragraph.');
      expect(sections.details).toBe('# Implementation Details\n\nSome implementation content here.');
      expect(sections.acceptanceCriteria).toBe('# Acceptance Criteria\n\nSome criteria here.');
      expect(sections.testStrategy).toBe('# Test Strategy\n\nSome test strategy here.');
    });

    test('should handle case insensitive section headers', () => {
      const fullDescription = `Main content.

## IMPLEMENTATION DETAILS

Details content.

## acceptance criteria

Criteria content.

## Test STRATEGY

Strategy content.`;

      const sections = JiraTicket.parseStructuredDescription(fullDescription);

      expect(sections.description).toBe('Main content.');
      expect(sections.details).toBe('## IMPLEMENTATION DETAILS\n\nDetails content.');
      expect(sections.acceptanceCriteria).toBe('## acceptance criteria\n\nCriteria content.');
      expect(sections.testStrategy).toBe('## Test STRATEGY\n\nStrategy content.');
    });

    test('should handle alternative section header names', () => {
      const fullDescription = `Main content.

## Technical Details

Technical content.

## Definition of Done

DoD content.

## Testing Approach

Testing content.`;

      const sections = JiraTicket.parseStructuredDescription(fullDescription);

      expect(sections.description).toBe('Main content.');
      expect(sections.details).toBe('## Technical Details\n\nTechnical content.');
      expect(sections.acceptanceCriteria).toBe('## Definition of Done\n\nDoD content.');
      expect(sections.testStrategy).toBe('## Testing Approach\n\nTesting content.');
    });

    test('should preserve formatting within sections', () => {
      const fullDescription = `Main description.

## Implementation Details

### Code Structure

\`\`\`javascript
export class ExampleClass {
  constructor() {
    this.value = 'test';
  }
}
\`\`\`

#### Important Notes
- **Bold text** should be preserved
- *Italic text* should be preserved
- [Links](http://example.com) should be preserved

## Acceptance Criteria

- [ ] Checkbox item 1
- [x] Completed checkbox item
- [ ] Another checkbox item`;

      const sections = JiraTicket.parseStructuredDescription(fullDescription);

      expect(sections.details).toContain('```javascript');
      expect(sections.details).toContain('export class ExampleClass');
      expect(sections.details).toContain('constructor()');
    });

    test('should handle description with no structured sections', () => {
      const fullDescription = `This is just a simple description with no structured sections.

It has multiple paragraphs but no special headers that indicate sections.

This should all remain in the description field.`;

      const sections = JiraTicket.parseStructuredDescription(fullDescription);

      expect(sections.description).toBe(fullDescription);
      expect(sections.details).toBe('');
      expect(sections.acceptanceCriteria).toBe('');
      expect(sections.testStrategy).toBe('');
    });

    test('should handle empty or undefined input', () => {
      expect(JiraTicket.parseStructuredDescription('')).toEqual({
        description: '',
        acceptanceCriteria: '',
        details: '',
        testStrategy: ''
      });

      expect(JiraTicket.parseStructuredDescription(null)).toEqual({
        description: '',
        acceptanceCriteria: '',
        details: '',
        testStrategy: ''
      });

      expect(JiraTicket.parseStructuredDescription(undefined)).toEqual({
        description: '',
        acceptanceCriteria: '',
        details: '',
        testStrategy: ''
      });
    });
  });

  describe('fromJiraIssue', () => {
    test('should properly parse issue with structured description', async () => {
      const mockJiraIssue = {
        key: 'JAR-586',
        fields: {
          summary: 'Jira-Bitbucket Context Integration for Enhanced AI Decision Making',
          description: {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Implement intelligent context retrieval that combines Jira ticket relationships with Bitbucket Pull Request data to provide comprehensive context for AI-assisted task planning and development decisions.'
                  }
                ]
              },
              {
                type: 'heading',
                attrs: { level: 2 },
                content: [{ type: 'text', text: 'Current Problem' }]
              },
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'When Taskmaster MCP retrieves Jira tickets via get_jira_task, get_jira_tasks, or next_jira_task tools, the LLM operates with limited context - only seeing isolated ticket information.'
                  }
                ]
              },
              {
                type: 'panel',
                attrs: { panelType: 'info' },
                content: [
                  {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Implementation Details' }]
                  },
                  {
                    type: 'paragraph',
                    content: [
                      {
                        type: 'text',
                        text: 'Phase 1: Foundation Infrastructure\n1.1 Bitbucket API Client Setup'
                      }
                    ]
                  }
                ]
              },
              {
                type: 'panel',
                attrs: { panelType: 'success' },
                content: [
                  {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Acceptance Criteria' }]
                  },
                  {
                    type: 'paragraph',
                    content: [
                      {
                        type: 'text',
                        text: '- [ ] Bitbucket API client successfully authenticates and fetches PRs'
                      }
                    ]
                  }
                ]
              }
            ]
          },
          priority: { name: 'High' },
          status: { name: 'In Progress' },
          issuetype: { name: 'Task' },
          issuelinks: [],
          labels: [],
          attachment: []
        }
      };

      const ticket = await JiraTicket.fromJiraIssue(mockJiraIssue);

      // Should properly separate the main description from panels
      expect(ticket.description).toContain('Implement intelligent context retrieval');
      expect(ticket.description).toContain('Current Problem');
      expect(ticket.description).not.toContain('Implementation Details');
      expect(ticket.description).not.toContain('Acceptance Criteria');

      // Should extract panel content correctly
      expect(ticket.details).toContain('Phase 1: Foundation Infrastructure');
      expect(ticket.details).toContain('1.1 Bitbucket API Client Setup');

      expect(ticket.acceptanceCriteria).toContain('- [ ] Bitbucket API client successfully authenticates');

      // Should preserve other properties
      expect(ticket.title).toBe('Jira-Bitbucket Context Integration for Enhanced AI Decision Making');
      expect(ticket.priority).toBe('High');
      expect(ticket.status).toBe('In Progress');
      expect(ticket.jiraKey).toBe('JAR-586');
    });

    test('should handle issue with no panels (plain text description)', async () => {
      const mockJiraIssue = {
        key: 'TEST-123',
        fields: {
          summary: 'Simple Task',
          description: {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'This is a simple task with just a plain description.\n\n## Implementation Details\n\nSome implementation details here.\n\n## Acceptance Criteria\n\n- [ ] Complete the task\n- [ ] Test the functionality'
                  }
                ]
              }
            ]
          },
          priority: { name: 'Medium' },
          status: { name: 'To Do' },
          issuetype: { name: 'Task' },
          issuelinks: [],
          labels: [],
          attachment: []
        }
      };

      const ticket = await JiraTicket.fromJiraIssue(mockJiraIssue);

      // Should parse structured content even when not in panels
      expect(ticket.description).toBe('This is a simple task with just a plain description.');
      expect(ticket.details).toContain('## Implementation Details');
      expect(ticket.details).toContain('Some implementation details here.');
      expect(ticket.acceptanceCriteria).toContain('## Acceptance Criteria');
      expect(ticket.acceptanceCriteria).toContain('- [ ] Complete the task');
    });
  });

  describe('extractTextFromNodes (ADF parsing)', () => {
    test('should preserve code blocks with language specification', () => {
      const nodes = [
        {
          type: 'codeBlock',
          attrs: { language: 'javascript' },
          content: [
            {
              type: 'text',
              text: 'export class ExampleClass {\n  constructor() {\n    this.value = "test";\n  }\n}'
            }
          ]
        }
      ];

      const result = JiraTicket.extractTextFromNodes(nodes);
      
      expect(result).toContain('```');
      expect(result).toContain('export class ExampleClass');
      expect(result).toContain('constructor()');
    });

    test('should preserve inline formatting', () => {
      const nodes = [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'This is ' },
            { 
              type: 'text', 
              marks: [{ type: 'strong' }],
              text: 'bold text'
            },
            { type: 'text', text: ' and this is ' },
            {
              type: 'text',
              marks: [{ type: 'code' }],
              text: 'inline code'
            },
            { type: 'text', text: '.' }
          ]
        }
      ];

      const result = JiraTicket.extractTextFromNodes(nodes);
      
      expect(result).toContain('This is bold text and this is `inline code`.');
    });

    test('should handle nested lists properly', () => {
      const nodes = [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'First item' }]
                }
              ]
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Second item' }]
                }
              ]
            }
          ]
        }
      ];

      const result = JiraTicket.extractTextFromNodes(nodes);
      
      expect(result).toContain('- First item');
      expect(result).toContain('- Second item');
    });
  });

  describe('Real JAR-586 scenario debugging', () => {
    test('should debug the current JAR-586 parsing issue', () => {
      // This is the actual content structure we're seeing from JAR-586
      const jarContent = `Implement intelligent context retrieval that combines Jira ticket relationships with Bitbucket Pull Request data to provide comprehensive context for AI-assisted task planning and development decisions.
## Current Problem
When Taskmaster MCP retrieves Jira tickets via get_jira_task, get_jira_tasks, or next_jira_task tools, the LLM operates with limited context - only seeing isolated ticket information. This leads to:
- Duplicate work and conflicting implementations

- Missing dependencies on related work

- Lack of awareness of existing solutions in linked PRs

- Suboptimal task breakdown without understanding prior approaches

## Solution Overview
Implement a Hybrid Smart Retrievalsystem that intelligently combines:
1.Jira Relationship Traversalfor immediate hierarchical context
2.Bitbucket Integrationfor actual implementation details and outcomes
3.Semantic Enhancement (optional future phase) for broader context discovery

## Implementation Details
## Technical Implementation Plan
### Phase 1: Foundation Infrastructure
#### 1.1 Bitbucket API Client Setup
File: \\`mcp-server/src/core/utils/bitbucket-client.js\\`- Create new client similar to existing\\`jira-client.js\\`pattern
- Environment variables:\\`BITBUCKET_WORKSPACE\\`, \\`BITBUCKET_USERNAME\\`, \\`BITBUCKET_APP_PASSWORD\\`- Authentication via Basic Auth (username + app password)

## Acceptance Criteria
## Acceptance Criteria
### Phase 1: Foundation (Must Have)
- [ ] Bitbucket API client successfully authenticates and fetches PRs

- [ ] Jira relationship resolver traverses parent/child, epic/story, issuelinks up to 2 levels

- [ ] Ticket-PR matching identifies linked PRs via commit messages and branch names

- [ ] All components handle authentication failures and API rate limits gracefully

## Test Strategy (TDD)
## Testing Strategy
### Unit Testing
- Bitbucket Client: Mock API responses, test authentication, error handling

- Relationship Resolver: Test traversal logic with various ticket hierarchies

- PR Matcher: Test pattern matching with different commit/branch formats

- Context Aggregator: Test data combination and filtering logic`;

      const sections = JiraTicket.parseStructuredDescription(jarContent);
      
      // Verify the parsing works correctly
      expect(sections.description).toContain('Implement intelligent context retrieval');
      expect(sections.description).toContain('## Solution Overview');
      expect(sections.description).not.toContain('## Implementation Details');
      
      expect(sections.details).toContain('## Implementation Details');
      expect(sections.details).toContain('## Technical Implementation Plan');
      expect(sections.details).toContain('File: `mcp-server/src/core/utils/bitbucket-client.js`');
      
      expect(sections.acceptanceCriteria).toContain('## Acceptance Criteria');
      expect(sections.acceptanceCriteria).toContain('Phase 1: Foundation');
      
      expect(sections.testStrategy).toContain('Testing Strategy');
      expect(sections.testStrategy).toContain('Unit Testing');
    });

    test('should include section headers in details field', () => {
      const contentWithMissingHeaders = `Main description here.

## Implementation Details
## Technical Implementation Plan
### Phase 1: Foundation Infrastructure
#### 1.1 Bitbucket API Client Setup
File: \\`mcp-server/src/core/utils/bitbucket-client.js\\`- Create new client similar to existing\\`jira-client.js\\`pattern
- Environment variables:\\`BITBUCKET_WORKSPACE\\`, \\`BITBUCKET_USERNAME\\`, \\`BITBUCKET_APP_PASSWORD\\`

## Acceptance Criteria
### Phase 1: Foundation (Must Have)
- [ ] Bitbucket API client successfully authenticates and fetches PRs`;

      const sections = JiraTicket.parseStructuredDescription(contentWithMissingHeaders);
      
      // The details section should include the headers
      expect(sections.details).toContain('## Implementation Details');
      expect(sections.details).toContain('## Technical Implementation Plan');
      expect(sections.details).toContain('File: `mcp-server/src/core/utils/bitbucket-client.js`');
      
      // Verify it doesn't start with "File:" but with the header
      expect(sections.details.trim()).toMatch(/^## Implementation Details/);
    });

    test('should debug actual MCP response issue - details starting with File:', () => {
      // Test the fromJiraIssue method with mock data that simulates the issue
      const mockJiraIssue = {
        key: 'JAR-586',
        fields: {
          summary: 'Test Issue',
          description: {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Main description content here.'
                  }
                ]
              },
              {
                type: 'panel',
                attrs: {
                  panelType: 'info'
                },
                content: [
                  {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [
                      {
                        type: 'text',
                        text: 'Implementation Details'
                      }
                    ]
                  },
                  {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [
                      {
                        type: 'text',
                        text: 'Technical Implementation Plan'
                      }
                    ]
                  },
                  {
                    type: 'paragraph',
                    content: [
                      {
                        type: 'text',
                        text: 'File: `mcp-server/src/core/utils/bitbucket-client.js`- Create new client similar to existing`jira-client.js`pattern'
                      }
                    ]
                  }
                ]
              }
            ]
          },
          priority: { name: 'High' },
          status: { name: 'In Progress' },
          issuetype: { name: 'Task' }
        }
      };

      const ticket = JiraTicket.fromJiraIssue(mockJiraIssue);
      
      // The details should start with the header, not "File:"
      expect(ticket.details).toContain('## Implementation Details');
      expect(ticket.details).toContain('## Technical Implementation Plan');
      expect(ticket.details.trim()).toMatch(/^## Implementation Details/);
    });
  });
});