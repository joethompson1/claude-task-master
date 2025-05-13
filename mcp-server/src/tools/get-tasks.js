/**
 * tools/get-tasks.js
 * Tool to get all tasks from Task Master
 */

import { z } from 'zod';
import {
	createErrorResponse,
	handleApiResult,
	withNormalizedProjectRoot
} from './utils.js';
import { listTasksDirect } from '../core/task-master-core.js';
import { findTasksJsonPath } from '../core/utils/path-utils.js';
import { JiraClient } from '../core/utils/jira-client.js';

/**
 * Register the getTasks tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerListTasksTool(server) {
	if (!JiraClient.isJiraEnabled()) {
		server.addTool({
			name: 'get_tasks',
			description:
				'Get all tasks from Task Master, optionally filtering by status and including subtasks.',
			parameters: z.object({
				status: z
					.string()
					.optional()
					.describe("Filter tasks by status (e.g., 'pending', 'done')"),
				withSubtasks: z
					.boolean()
					.optional()
					.describe(
						'Include subtasks nested within their parent tasks in the response'
					),
				file: z
					.string()
					.optional()
					.describe(
						'Path to the tasks file (relative to project root or absolute)'
					),
				projectRoot: z
					.string()
					.describe('The directory of the project. Must be an absolute path.')
			}),
			execute: withNormalizedProjectRoot(async (args, { log, session }) => {
				try {
					log.info(`Getting tasks with filters: ${JSON.stringify(args)}`);
	
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
	
					const result = await listTasksDirect(
						{
							tasksJsonPath: tasksJsonPath,
							status: args.status,
							withSubtasks: args.withSubtasks
						},
						log
					);
	
					log.info(
						`Retrieved ${result.success ? result.data?.tasks?.length || 0 : 0} tasks${result.fromCache ? ' (from cache)' : ''}`
					);
					return handleApiResult(result, log, 'Error getting tasks');
				} catch (error) {
					log.error(`Error getting tasks: ${error.message}`);
					return createErrorResponse(error.message);
				}
			})
		});
	} else {
		server.addTool({
			name: 'get_jira_tasks',
			description:
				'Get all tasks from Jira, optionally filtering by status and including subtasks.',
			parameters: z.object({
				status: z
					.string()
					.optional()
					.describe("Filter tasks by status (e.g., 'pending', 'done')"),
				withSubtasks: z
					.boolean()
					.optional()
					.default(false)
					.describe(
						'Include subtasks nested within their parent tasks in the response'
					),
				parentKey: z
					.string()
					.optional()
					.describe('Parent Jira issue key, leave blank to get all tasks'),
			}),
			execute: async (args, { log, session }) => {
				try {
					log.info(`Getting tasks with filters: ${JSON.stringify(args)}`);

					const result = await listTasksDirect(
						{
							status: args.status,
							withSubtasks: args.withSubtasks,
							parentKey: args.parentKey || null
						},
						log
					);

					log.info(
						`Retrieved ${result.success ? result.data?.tasks?.length || 0 : 0} tasks${result.fromCache ? ' (from cache)' : ''} from Jira`
					);
					return handleApiResult(result, log, 'Error getting tasks');
				} catch (error) {
					log.error(`Error getting tasks: ${error.message}`);
					return createErrorResponse(error.message);
				}
			}
		});
	}
}

// We no longer need the formatTasksResponse function as we're returning raw JSON data
