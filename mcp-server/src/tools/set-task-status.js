/**
 * tools/setTaskStatus.js
 * Tool to set the status of a task
 */

import { z } from 'zod';
import {
	handleApiResult,
	createErrorResponse,
	withNormalizedProjectRoot
} from './utils.js';
import {
	setTaskStatusDirect,
	setJiraTaskStatusDirect
} from '../core/task-master-core.js';
import { findTasksJsonPath } from '../core/utils/path-utils.js';
import { JiraClient } from '../core/utils/jira-client.js';

/**
 * Register the setTaskStatus tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerSetTaskStatusTool(server) {
	if (!JiraClient.isJiraEnabled()) {
		server.addTool({
			name: 'set_task_status',
			description: 'Set the status of one or more tasks or subtasks.',
			parameters: z.object({
				id: z
					.string()
					.describe(
						"Task ID or subtask ID (e.g., '15', '15.2'). Can be comma-separated to update multiple tasks/subtasks at once."
					),
				status: z
					.string()
					.describe(
						"New status to set (e.g., 'pending', 'done', 'in-progress', 'review', 'deferred', 'cancelled'."
					),
				file: z.string().optional().describe('Absolute path to the tasks file'),
				projectRoot: z
					.string()
					.describe('The directory of the project. Must be an absolute path.')
			}),
			execute: withNormalizedProjectRoot(async (args, { log }) => {
				try {
					log.info(`Setting status of task(s) ${args.id} to: ${args.status}`);

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

					const result = await setTaskStatusDirect(
						{
							tasksJsonPath: tasksJsonPath,
							id: args.id,
							status: args.status
						},
						log
					);

					if (result.success) {
						log.info(
							`Successfully updated status for task(s) ${args.id} to "${args.status}": ${result.data.message}`
						);
					} else {
						log.error(
							`Failed to update task status: ${result.error?.message || 'Unknown error'}`
						);
					}

					return handleApiResult(result, log, 'Error setting task status');
				} catch (error) {
					log.error(`Error in setTaskStatus tool: ${error.message}`);
					return createErrorResponse(
						`Error setting task status: ${error.message}`
					);
				}
			})
		});
	} else {
		server.addTool({
			name: 'set_jira_task_status',
			description: 'Set the status of one or more tasks or subtasks in Jira.',
			parameters: z.object({
				id: z
					.string()
					.describe(
						"Jira issue key(s) to update (e.g., 'PROJ-123', 'PROJ-124'). Can be comma-separated for multiple updates."
					),
				status: z
					.string()
					.describe(
						"New status to set (e.g., 'To Do', 'In Progress', 'Done', 'In Review' etc)."
					)
			}),
			execute: async (args, { log, session }) => {
				try {
					log.info(
						`Setting status of Jira issue(s) ${args.id} to: ${args.status}`
					);

					// Call the direct function for Jira status updates
					const result = await setJiraTaskStatusDirect(
						{
							id: args.id,
							status: args.status
						},
						log
					);

					// Log the result
					if (result.success) {
						log.info(
							`Successfully updated status for Jira issue(s) ${args.id} to "${args.status}": ${result.data.message}`
						);
					} else {
						log.error(
							`Failed to update Jira issue status: ${result.error?.message || 'Unknown error'}`
						);
					}

					// Format and return the result
					return handleApiResult(
						result,
						log,
						'Error setting Jira issue status'
					);
				} catch (error) {
					log.error(`Error in setJiraTaskStatus tool: ${error.message}`);
					return createErrorResponse(
						`Error setting Jira issue status: ${error.message}`
					);
				}
			}
		});
	}
}
