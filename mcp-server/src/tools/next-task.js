/**
 * tools/next-task.js
 * Tool to find the next task to work on
 */

import { z } from 'zod';
import {
	handleApiResult,
	createErrorResponse,
	withNormalizedProjectRoot
} from './utils.js';
import {
	nextTaskDirect,
	nextJiraTaskDirect
} from '../core/task-master-core.js';
import { findTasksJsonPath } from '../core/utils/path-utils.js';
import { JiraClient } from '../core/utils/jira-client.js';

/**
 * Register the next-task tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerNextTaskTool(server) {
	if (!JiraClient.isJiraEnabled()) {
		server.addTool({
			name: 'next_task',
			description:
				'Find the next task to work on based on dependencies and status',
			parameters: z.object({
				file: z.string().optional().describe('Absolute path to the tasks file'),
				projectRoot: z
					.string()
					.describe('The directory of the project. Must be an absolute path.')
			}),
			execute: withNormalizedProjectRoot(async (args, { log, session }) => {
				try {
					log.info(`Finding next task with args: ${JSON.stringify(args)}`);

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

					const result = await nextTaskDirect(
						{
							tasksJsonPath: tasksJsonPath
						},
						log
					);

					if (result.success) {
						log.info(
							`Successfully found next task: ${result.data?.task?.id || 'No available tasks'}`
						);
					} else {
						log.error(
							`Failed to find next task: ${result.error?.message || 'Unknown error'}`
						);
					}

					return handleApiResult(result, log, 'Error finding next task');
				} catch (error) {
					log.error(`Error in nextTask tool: ${error.message}`);
					return createErrorResponse(error.message);
				}
			})
		});
	} else {
		server.addTool({
			name: 'next_jira_task',
			description:
				'Find the next Jira task to work on based on dependencies and status',
			parameters: z.object({
				parentKey: z
					.string()
					.describe(
						'Parent Jira issue key (epic or task with subtasks) to filter tasks by, if no parent key is provided, pass in "all" as the parameter'
					)
			}),
			execute: async (args, { log, session }) => {
				try {
					log.info(`Finding next task with args: ${JSON.stringify(args)}`);

					// Check if parentKey is 'all' and set to null to fetch all tasks
					const parentKey = args.parentKey === 'all' ? null : args.parentKey;

					const result = await nextJiraTaskDirect(
						{
							parentKey: parentKey
						},
						log
					);

					if (result.success) {
						log.info(
							`Successfully found next task: ${result.data?.nextTask?.id || 'No available tasks'}`
						);
					} else {
						log.error(
							`Failed to find next task: ${result.error?.message || 'Unknown error'}`
						);
					}

					return handleApiResult(result, log, 'Error finding next task');
				} catch (error) {
					log.error(`Error in nextTask tool: ${error.message}`);
					return createErrorResponse(error.message);
				}
			}
		});
	}
}
