/**
 * tools/add-task.js
 * Tool to add a new task using AI
 */

import { z } from 'zod';
import {
	createErrorResponse,
	getProjectRootFromSession,
	handleApiResult,
	withNormalizedProjectRoot
} from './utils.js';
import { addTaskDirect } from '../core/task-master-core.js';
import { findTasksJsonPath } from '../core/utils/path-utils.js';
import { addJiraTaskDirect } from '../core/task-master-core.js';
import { JiraClient } from '../core/utils/jira-client.js';

/**
 * Register the addTask tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerAddTaskTool(server) {
	if (!JiraClient.isJiraEnabled()) {
		server.addTool({
			name: 'add_task',
			description: 'Add a new task using AI',
			parameters: z.object({
				prompt: z
					.string()
					.optional()
					.describe(
						'Description of the task to add (required if not using manual fields)'
					),
				title: z
					.string()
					.optional()
					.describe('Task title (for manual task creation)'),
				description: z
					.string()
					.optional()
					.describe('Task description (for manual task creation)'),
				details: z
					.string()
					.optional()
					.describe('Implementation details (for manual task creation)'),
				testStrategy: z
					.string()
					.optional()
					.describe('Test strategy (for manual task creation)'),
				dependencies: z
					.string()
					.optional()
					.describe('Comma-separated list of task IDs this task depends on'),
				priority: z
					.string()
					.optional()
					.describe('Task priority (high, medium, low)'),
				file: z
					.string()
					.optional()
					.describe('Path to the tasks file (default: tasks/tasks.json)'),
				projectRoot: z
					.string()
					.describe('The directory of the project. Must be an absolute path.'),
				research: z
					.boolean()
					.optional()
					.describe('Whether to use research capabilities for task creation')
			}),
			execute: withNormalizedProjectRoot(async (args, { log, session }) => {
				try {
					log.info(`Starting add-task with args: ${JSON.stringify(args)}`);

					// Use args.projectRoot directly (guaranteed by withNormalizedProjectRoot)
					let tasksJsonPath;
					try {
						tasksJsonPath = findTasksJsonPath(
							{ projectRoot: args.projectRoot, file: args.file },
							log
						);
					} catch (error) {
						log.error(`Error finding tasks.json: ${error.message}`);
						return createErrorResponse(
							`Failed to find tasks.json: ${error.message}`
						);
					}

					// Call the direct functionP
					const result = await addTaskDirect(
						{
							tasksJsonPath: tasksJsonPath,
							prompt: args.prompt,
							title: args.title,
							description: args.description,
							details: args.details,
							testStrategy: args.testStrategy,
							dependencies: args.dependencies,
							priority: args.priority,
							research: args.research,
							projectRoot: args.projectRoot
						},
						log,
						{ session }
					);

					return handleApiResult(result, log);
				} catch (error) {
					log.error(`Error in add-task tool: ${error.message}`);
					return createErrorResponse(error.message);
				}
			})
		});
	} else {
		server.addTool({
			name: 'add_jira_issue',
			description:
				'Creates a new issue in Jira with proper markdown formatting. All text fields support full markdown syntax including headers, lists, code blocks, bold/italic text, and links. The content is automatically converted to Atlassian Document Format (ADF) for optimal Jira display.',
			parameters: z.object({
				title: z
					.string()
					.describe(
						'The title/summary for the new issue (plain text, no markdown)'
					),
				description: z
					.string()
					.optional()
					.describe(
						'The main description for the issue. FORMATTING GUIDE: Use markdown syntax - ## for headers, **bold**, *italic*, `inline code`, ```language code blocks```, - for bullet lists, 1. for numbered lists, [link text](url) for links. This will be displayed as the main ticket description in Jira.'
					),
				issueType: z
					.string()
					.optional()
					.describe(
						'The issue type for the issue (default: Task, Epic, Story, Bug, Subtask)'
					),
				details: z
					.string()
					.optional()
					.describe(
						'Implementation details and technical specifications. FORMATTING GUIDE: Use markdown for structure - ## Implementation Steps, ### Database Schema, ```sql code```, **Important:** notes, - Step 1, - Step 2. This content will appear in a blue "Implementation Details" panel in Jira for clear separation from the main description.'
					),
				acceptanceCriteria: z
					.string()
					.optional()
					.describe(
						'Acceptance criteria and requirements that must be met. FORMATTING GUIDE: Use markdown checklists - [ ] for incomplete items, **Must have:** for emphasis, ### Additional Requirements for sections. This content will appear in a green "Acceptance Criteria" panel in Jira to highlight completion requirements.'
					),
				testStrategy: z
					.string()
					.optional()
					.describe(
						'Testing approach and strategy. FORMATTING GUIDE: Use markdown structure - ## Unit Tests, ```bash test commands```, ### Performance Tests, **Target:** for goals, - Test case 1. This content will appear in a gray "Test Strategy (TDD)" panel in Jira for clear testing guidance.'
					),
				parentKey: z
					.string()
					.optional()
					.describe(
						"The Jira key of the Epic/parent to link this issue to (e.g., 'PROJ-5')"
					),
				priority: z
					.string()
					.optional()
					.describe("Jira priority name (e.g., 'Medium', 'High')"),
				assignee: z
					.string()
					.optional()
					.describe('Jira account ID or email of the assignee'),
				labels: z
					.array(z.string())
					.optional()
					.describe('List of labels to add'),
				projectRoot: z
					.string()
					.optional()
					.describe(
						'Root directory of the project (typically derived from session)'
					)
			}),

			execute: async (args, { log, session }) => {
				try {
					log.info(`Starting addJiraTask with args: ${JSON.stringify(args)}`);

					// Get project root from args or session
					const rootFolder =
						args.projectRoot || getProjectRootFromSession(session, log);

					// Even though Jira functions don't actually need the project root,
					// we follow the standard pattern for consistency
					log.info(
						`Project root: ${rootFolder || 'Not determined, using session context'}`
					);

					try {
						// Call the direct function
						const result = await addJiraTaskDirect(
							{
								// Pass all parameters from args
								title: args.title,
								issueType: args.issueType,
								description: args.description,
								details: args.details,
								acceptanceCriteria: args.acceptanceCriteria,
								testStrategy: args.testStrategy,
								parentKey: args.parentKey,
								priority: args.priority,
								assignee: args.assignee,
								labels: args.labels
							},
							log,
							{ session }
						);

						// Log the full result for debugging
						log.info(
							`Full result from addJiraTaskDirect: ${JSON.stringify(result)}`
						);

						// Return the formatted result
						return handleApiResult(result, log);
					} catch (innerError) {
						// Catch and log any direct error from the function call itself
						log.error(`Direct function execution error: ${innerError.message}`);
						log.error(`Error stack: ${innerError.stack}`);

						// Return a detailed error response
						return createErrorResponse({
							message: `Direct error in addJiraTask: ${innerError.message}`,
							details: innerError.stack,
							displayMessage: `Error executing Jira task creation: ${innerError.message}`
						});
					}
				} catch (error) {
					// Log the full error object for debugging
					log.error(`Error in addJiraTask tool: ${error.message}`);
					log.error(
						`Error details: ${JSON.stringify({
							name: error.name,
							message: error.message,
							stack: error.stack,
							response: error.response
								? {
										status: error.response.status,
										statusText: error.response.statusText,
										data: error.response.data
									}
								: 'No response data',
							code: error.code
						})}`
					);

					// Create a comprehensive error response
					return createErrorResponse({
						message: error.message,
						details: error.stack,
						displayMessage: `Jira API Error: ${error.message}${
							error.response
								? ` (Status: ${error.response.status} ${error.response.statusText})`
								: ''
						}${
							error.response?.data?.errorMessages
								? ` - ${error.response.data.errorMessages.join(', ')}`
								: ''
						}`
					});
				}
			}
		});
	}
}
