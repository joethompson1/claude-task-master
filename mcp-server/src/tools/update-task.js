/**
 * tools/update-task.js
 * Tool to update a single task by ID with new information
 */

import { z } from 'zod';
import {
	handleApiResult,
	createErrorResponse,
	withNormalizedProjectRoot
} from './utils.js';
import {
	updateTaskByIdDirect,
	updateJiraTaskByIdDirect
} from '../core/task-master-core.js';
import { findTasksJsonPath } from '../core/utils/path-utils.js';
import { JiraClient } from '../core/utils/jira-client.js';

/**
 * Register the update-task tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerUpdateTaskTool(server) {
	if (!JiraClient.isJiraEnabled()) {
		server.addTool({
			name: 'update_task',
			description:
				'Updates a single task by ID with new information or context provided in the prompt.',
			parameters: z.object({
				id: z
					.string() // ID can be number or string like "1.2"
					.describe(
						"ID of the task (e.g., '15') to update. Subtasks are supported using the update-subtask tool."
					),
				prompt: z
					.string()
					.describe('New information or context to incorporate into the task'),
				research: z
					.boolean()
					.optional()
					.describe('Use Perplexity AI for research-backed updates'),
				file: z.string().optional().describe('Absolute path to the tasks file'),
				projectRoot: z
					.string()
					.describe('The directory of the project. Must be an absolute path.')
			}),
			execute: withNormalizedProjectRoot(async (args, { log, session }) => {
				const toolName = 'update_task';
				try {
					log.info(
						`Executing ${toolName} tool with args: ${JSON.stringify(args)}`
					);

					let tasksJsonPath;
					try {
						tasksJsonPath = findTasksJsonPath(
							{ projectRoot: args.projectRoot, file: args.file },
							log
						);
						log.info(`${toolName}: Resolved tasks path: ${tasksJsonPath}`);
					} catch (error) {
						log.error(
							`${toolName}: Error finding tasks.json: ${error.message}`
						);
						return createErrorResponse(
							`Failed to find tasks.json: ${error.message}`
						);
					}

					// 3. Call Direct Function - Include projectRoot
					const result = await updateTaskByIdDirect(
						{
							tasksJsonPath: tasksJsonPath,
							id: args.id,
							prompt: args.prompt,
							research: args.research,
							projectRoot: args.projectRoot
						},
						log,
						{ session }
					);

					// 4. Handle Result
					log.info(
						`${toolName}: Direct function result: success=${result.success}`
					);
					return handleApiResult(result, log, 'Error updating task');
				} catch (error) {
					log.error(
						`Critical error in ${toolName} tool execute: ${error.message}`
					);
					return createErrorResponse(
						`Internal tool error (${toolName}): ${error.message}`
					);
				}
			})
		});
	} else {
		server.addTool({
			name: 'update_jira_task',
			description:
				'Updates a single Jira task by ID with new information or context provided in the prompt.',
			parameters: z.object({
				id: z
					.string()
					.describe("Jira issue key of the task to update (e.g., 'PROJ-123')."),
				prompt: z
					.string()
					.describe('New information or context to incorporate into the task'),
				research: z
					.boolean()
					.optional()
					.describe('Use Perplexity AI for research-backed updates')
			}),
			execute: async (args, { log, session }) => {
				try {
					log.info(`Updating Jira task with args: ${JSON.stringify(args)}`);

					const result = await updateJiraTaskByIdDirect(
						{
							id: args.id,
							prompt: args.prompt,
							research: args.research
						},
						log,
						{ session }
					);

					if (result.success) {
						log.info(`Successfully updated Jira task with ID ${args.id}`);
					} else {
						log.error(
							`Failed to update Jira task: ${result.error?.message || 'Unknown error'}`
						);
					}

					return handleApiResult(result, log, 'Error updating Jira task');
				} catch (error) {
					log.error(`Error in update_jira_task tool: ${error.message}`);
					return createErrorResponse(error.message);
				}
			}
		});
	}
}
