/**
 * tools/add-subtask.js
 * Tool for adding subtasks to existing tasks
 */

import { z } from 'zod';
import {
	handleApiResult,
	createErrorResponse,
	withNormalizedProjectRoot
} from './utils.js';
import {
	addSubtaskDirect,
	addJiraSubtaskDirect
} from '../core/task-master-core.js';
import { findTasksJsonPath } from '../core/utils/path-utils.js';
import { JiraClient } from '../core/utils/jira-client.js';

/**
 * Register the addSubtask tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerAddSubtaskTool(server) {
	if (!JiraClient.isJiraEnabled()) {
		server.addTool({
			name: 'add_subtask',
			description: 'Add a subtask to an existing task',
			parameters: z.object({
				id: z.string().describe('Parent task ID (required)'),
				taskId: z
					.string()
					.optional()
					.describe('Existing task ID to convert to subtask'),
				title: z
					.string()
					.optional()
					.describe('Title for the new subtask (when creating a new subtask)'),
				description: z
					.string()
					.optional()
					.describe('Description for the new subtask'),
				details: z
					.string()
					.optional()
					.describe('Implementation details for the new subtask'),
				status: z
					.string()
					.optional()
					.describe("Status for the new subtask (default: 'pending')"),
				dependencies: z
					.string()
					.optional()
					.describe(
						'Comma-separated list of dependency IDs for the new subtask'
					),
				file: z
					.string()
					.optional()
					.describe(
						'Absolute path to the tasks file (default: tasks/tasks.json)'
					),
				skipGenerate: z
					.boolean()
					.optional()
					.describe('Skip regenerating task files'),
				projectRoot: z
					.string()
					.describe('The directory of the project. Must be an absolute path.')
			}),
			execute: withNormalizedProjectRoot(async (args, { log, session }) => {
				try {
					log.info(`Adding subtask with args: ${JSON.stringify(args)}`);

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

					const result = await addSubtaskDirect(
						{
							tasksJsonPath: tasksJsonPath,
							id: args.id,
							taskId: args.taskId,
							title: args.title,
							description: args.description,
							details: args.details,
							status: args.status,
							dependencies: args.dependencies,
							skipGenerate: args.skipGenerate
						},
						log
					);

					if (result.success) {
						log.info(`Subtask added successfully: ${result.data.message}`);
					} else {
						log.error(`Failed to add subtask: ${result.error.message}`);
					}

					return handleApiResult(result, log, 'Error adding subtask');
				} catch (error) {
					log.error(`Error in addSubtask tool: ${error.message}`);
					return createErrorResponse(error.message);
				}
			})
		});
	} else {
		server.addTool({
			name: 'add_jira_subtask',
			description:
				'Creates a new subtask under a specified parent issue in Jira',
			parameters: z.object({
				parentKey: z
					.string()
					.describe("The Jira key of the parent issue (e.g., 'PROJ-123')"),
				title: z.string().describe('The title/summary for the new subtask'),
				description: z
					.string()
					.optional()
					.describe('The description for the subtask'),
				details: z
					.string()
					.optional()
					.describe('The implementation details for the subtask'),
				acceptanceCriteria: z
					.string()
					.optional()
					.describe('The acceptance criteria for the subtask'),
				testStrategy: z
					.string()
					.optional()
					.describe('The test strategy for the subtask'),
				priority: z
					.string()
					.optional()
					.describe("Jira priority name (e.g., 'Medium', 'High')"),
				assignee: z
					.string()
					.optional()
					.describe('Jira account ID or email of the assignee'),
				labels: z.array(z.string()).optional().describe('List of labels to add')
			}),

			execute: async (args, { log, session }) => {
				try {
					log.info(
						`Starting addJiraSubtask with args: ${JSON.stringify(args)}`
					);

					try {
						// Call the direct function
						const result = await addJiraSubtaskDirect(
							{
								// Pass all parameters from args
								parentKey: args.parentKey,
								title: args.title,
								description: args.description,
								details: args.details,
								acceptanceCriteria: args.acceptanceCriteria,
								testStrategy: args.testStrategy,
								priority: args.priority,
								assignee: args.assignee,
								labels: args.labels
							},
							log,
							{ session }
						);

						// Log the full result for debugging
						log.info(
							`Full result from addJiraSubtaskDirect: ${JSON.stringify(result)}`
						);

						// Return the formatted result
						return handleApiResult(result, log);
					} catch (innerError) {
						// Catch and log any direct error from the function call itself
						log.error(`Direct function execution error: ${innerError.message}`);
						log.error(`Error stack: ${innerError.stack}`);

						// Return a detailed error response
						return createErrorResponse({
							message: `Direct error in addJiraSubtask: ${innerError.message}`,
							details: innerError.stack,
							displayMessage: `Error executing Jira subtask creation: ${innerError.message}`
						});
					}
				} catch (error) {
					// Log the full error object for debugging
					log.error(`Error in addJiraSubtask tool: ${error.message}`);
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
