/**
 * tools/clear-subtasks.js
 * Tool for clearing subtasks from parent tasks
 */

import { z } from 'zod';
import {
	handleApiResult,
	createErrorResponse,
	withNormalizedProjectRoot
} from './utils.js';
import { findTasksJsonPath } from '../core/utils/path-utils.js';
import {
	clearSubtasksDirect,
	clearJiraSubtasksDirect
} from '../core/task-master-core.js';
import { JiraClient } from '../core/utils/jira-client.js';

/**
 * Register the clearSubtasks tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerClearSubtasksTool(server) {
	if (!JiraClient.isJiraEnabled()) {
		server.addTool({
			name: 'clear_subtasks',
			description: 'Clear subtasks from specified tasks',
			parameters: z
				.object({
					id: z
						.string()
						.optional()
						.describe('Task IDs (comma-separated) to clear subtasks from'),
					all: z.boolean().optional().describe('Clear subtasks from all tasks'),
					file: z
						.string()
						.optional()
						.describe(
							'Absolute path to the tasks file (default: tasks/tasks.json)'
						),
					projectRoot: z
						.string()
						.describe('The directory of the project. Must be an absolute path.')
				})
				.refine((data) => data.id || data.all, {
					message: "Either 'id' or 'all' parameter must be provided",
					path: ['id', 'all']
				}),
			execute: withNormalizedProjectRoot(async (args, { log, session }) => {
				try {
					log.info(`Clearing subtasks with args: ${JSON.stringify(args)}`);

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

					const result = await clearSubtasksDirect(
						{
							tasksJsonPath: tasksJsonPath,
							id: args.id,
							all: args.all
						},
						log
					);

					if (result.success) {
						log.info(`Subtasks cleared successfully: ${result.data.message}`);
					} else {
						log.error(`Failed to clear subtasks: ${result.error.message}`);
					}

					return handleApiResult(result, log, 'Error clearing subtasks');
				} catch (error) {
					log.error(`Error in clearSubtasks tool: ${error.message}`);
					return createErrorResponse(error.message);
				}
			})
		});
	} else {
		server.addTool({
			name: 'clear_jira_subtasks',
			description: 'Clear subtasks from Jira parent issues',
			parameters: z
				.object({
					parentKey: z
						.string()
						.optional()
						.describe('Parent Jira issue key to clear subtasks from')
				})
				.refine((data) => data.parentKey, {
					message: "Either 'parentKey' parameter must be provided",
					path: ['parentKey']
				}),
			execute: async (args, { log, session }) => {
				try {
					log.info(`Clearing Jira subtasks with args: ${JSON.stringify(args)}`);

					const result = await clearJiraSubtasksDirect(
						{
							parentKey: args.parentKey,
							all: false
						},
						log,
						{ session }
					);

					if (result.success) {
						log.info(
							`Jira subtasks cleared successfully: ${result.data.message}`
						);
					} else {
						log.error(`Failed to clear Jira subtasks: ${result.error.message}`);
					}

					return handleApiResult(result, log, 'Error clearing Jira subtasks');
				} catch (error) {
					log.error(`Error in clear_jira_subtasks tool: ${error.message}`);
					return createErrorResponse(error.message);
				}
			}
		});
	}
}
