/**
 * tools/remove-dependency.js
 * Tool for removing a dependency from a task
 */

import { z } from 'zod';
import {
	handleApiResult,
	createErrorResponse,
	withNormalizedProjectRoot
} from './utils.js';
import {
	removeDependencyDirect,
	removeJiraDependencyDirect
} from '../core/task-master-core.js';
import { findTasksJsonPath } from '../core/utils/path-utils.js';
import { JiraClient } from '../core/utils/jira-client.js';

/**
 * Register the removeDependency tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerRemoveDependencyTool(server) {
	if (!JiraClient.isJiraEnabled()) {
		server.addTool({
			name: 'remove_dependency',
			description: 'Remove a dependency from a task',
			parameters: z.object({
				id: z.string().describe('Task ID to remove dependency from'),
				dependsOn: z.string().describe('Task ID to remove as a dependency'),
				file: z
					.string()
					.optional()
					.describe(
						'Absolute path to the tasks file (default: tasks/tasks.json)'
					),
				projectRoot: z
					.string()
					.describe('The directory of the project. Must be an absolute path.')
			}),
			execute: withNormalizedProjectRoot(async (args, { log, session }) => {
				try {
					log.info(
						`Removing dependency for task ${args.id} from ${args.dependsOn} with args: ${JSON.stringify(args)}`
					);

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

					const result = await removeDependencyDirect(
						{
							tasksJsonPath: tasksJsonPath,
							id: args.id,
							dependsOn: args.dependsOn
						},
						log
					);

					if (result.success) {
						log.info(`Successfully removed dependency: ${result.data.message}`);
					} else {
						log.error(`Failed to remove dependency: ${result.error.message}`);
					}

					return handleApiResult(result, log, 'Error removing dependency');
				} catch (error) {
					log.error(`Error in removeDependency tool: ${error.message}`);
					return createErrorResponse(error.message);
				}
			})
		});
	} else {
		server.addTool({
			name: 'remove_jira_dependency',
			description: 'Remove a dependency from a Jira issue',
			parameters: z.object({
				id: z
					.string()
					.describe(
						'Jira issue key to remove dependency from (e.g., PROJ-123)'
					),
				dependsOn: z
					.string()
					.describe('Jira issue key to remove as a dependency (e.g., PROJ-456)')
			}),
			execute: async (args, { log, session }) => {
				try {
					log.info(
						`Removing Jira dependency for issue ${args.id} from ${args.dependsOn}`
					);

					const result = await removeJiraDependencyDirect(
						{
							id: args.id,
							dependsOn: args.dependsOn
						},
						log,
						{ session }
					);

					if (result.success) {
						log.info(
							`Successfully removed Jira dependency: ${result.data.message}`
						);
					} else {
						log.error(
							`Failed to remove Jira dependency: ${result.error.message}`
						);
					}

					return handleApiResult(result, log, 'Error removing Jira dependency');
				} catch (error) {
					log.error(`Error in remove_dependency tool: ${error.message}`);
					return createErrorResponse(error.message);
				}
			}
		});
	}
}
