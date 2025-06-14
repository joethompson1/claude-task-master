/**
 * tools/remove-task.js
 * Tool to remove a task by ID
 */

import { z } from 'zod';
import {
	handleApiResult,
	createErrorResponse,
	withNormalizedProjectRoot
} from './utils.js';
import {
	removeTaskDirect,
	removeJiraTaskDirect
} from '../core/task-master-core.js';
import { findTasksJsonPath } from '../core/utils/path-utils.js';
import { JiraClient } from '../core/utils/jira-client.js';

/**
 * Register the remove-task tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerRemoveTaskTool(server) {
	if (!JiraClient.isJiraEnabled()) {
		server.addTool({
			name: 'remove_task',
			description: 'Remove a task or subtask permanently from the tasks list',
			parameters: z.object({
				id: z
					.string()
					.describe(
						"ID of the task or subtask to remove (e.g., '5' or '5.2'). Can be comma-separated to update multiple tasks/subtasks at once."
					),
				file: z.string().optional().describe('Absolute path to the tasks file'),
				projectRoot: z
					.string()
					.describe('The directory of the project. Must be an absolute path.'),
				confirm: z
					.boolean()
					.optional()
					.describe('Whether to skip confirmation prompt (default: false)')
			}),
			execute: withNormalizedProjectRoot(async (args, { log }) => {
				try {
					log.info(`Removing task(s) with ID(s): ${args.id}`);

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

					log.info(`Using tasks file path: ${tasksJsonPath}`);

					const result = await removeTaskDirect(
						{
							tasksJsonPath: tasksJsonPath,
							id: args.id
						},
						log
					);

					if (result.success) {
						log.info(`Successfully removed task: ${args.id}`);
					} else {
						log.error(`Failed to remove task: ${result.error.message}`);
					}

					return handleApiResult(result, log, 'Error removing task');
				} catch (error) {
					log.error(`Error in remove-task tool: ${error.message}`);
					return createErrorResponse(`Failed to remove task: ${error.message}`);
				}
			})
		});
	} else {
		server.addTool({
			name: 'remove_jira_task',
			description:
				'Remove a Jira issue (task or subtask) from the Jira project',
			parameters: z.object({
				id: z
					.string()
					.describe(
						"Jira issue key(s) to remove (e.g., 'PROJ-123' or 'PROJ-123,PROJ-124')"
					)
			}),
			execute: async (args, { log, session }) => {
				try {
					log.info(`Removing Jira issue(s) with key(s): ${args.id}`);

					// Call the direct function
					const result = await removeJiraTaskDirect(
						{
							id: args.id
						},
						log
					);

					return handleApiResult(result, log, 'Error removing Jira issue');
				} catch (error) {
					log.error(`Error in remove-jira-task tool: ${error.message}`);
					return createErrorResponse(
						`Failed to remove Jira issue: ${error.message}`
					);
				}
			}
		});
	}
}
