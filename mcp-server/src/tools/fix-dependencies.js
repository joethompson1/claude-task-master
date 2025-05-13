/**
 * tools/fix-dependencies.js
 * Tool for automatically fixing invalid task dependencies
 */

import { z } from 'zod';
import {
	handleApiResult,
	createErrorResponse,
	withNormalizedProjectRoot
} from './utils.js';
import { fixDependenciesDirect, fixJiraDependenciesDirect } from '../core/task-master-core.js';
import { findTasksJsonPath } from '../core/utils/path-utils.js';
import { JiraClient } from '../core/utils/jira-client.js';

/**
 * Register the fixDependencies tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerFixDependenciesTool(server) {
	if (!JiraClient.isJiraEnabled()) {
		server.addTool({
			name: 'fix_dependencies',
			description: 'Fix invalid dependencies in tasks automatically',
			parameters: z.object({
				file: z.string().optional().describe('Absolute path to the tasks file'),
				projectRoot: z
					.string()
					.describe('The directory of the project. Must be an absolute path.')
			}),
			execute: withNormalizedProjectRoot(async (args, { log, session }) => {
				try {
					log.info(`Fixing dependencies with args: ${JSON.stringify(args)}`);
	
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
	
					const result = await fixDependenciesDirect(
						{
							tasksJsonPath: tasksJsonPath
						},
						log
					);
	
					if (result.success) {
						log.info(`Successfully fixed dependencies: ${result.data.message}`);
					} else {
						log.error(`Failed to fix dependencies: ${result.error.message}`);
					}
	
					return handleApiResult(result, log, 'Error fixing dependencies');
				} catch (error) {
					log.error(`Error in fixDependencies tool: ${error.message}`);
					return createErrorResponse(error.message);
				}
			})
		});
	} else {
		server.addTool({
			name: 'fix_jira_dependencies',
			description: 'Fix invalid dependencies in Jira issues automatically',
			parameters: z.object({
				parentKey: z
					.string()
					.optional()
					.describe('Parent Jira issue key to filter tasks')
			}),
			execute: async (args, { log, session }) => {
				try {
					log.info(`Fixing Jira dependencies with args: ${JSON.stringify(args)}`);

					const result = await fixJiraDependenciesDirect(
						{
							parentKey: args.parentKey
						},
						log,
						{ session }
					);

					if (result.success) {
						log.info(`Successfully fixed Jira dependencies: ${result.data.message}`);
					} else {
						log.error(`Failed to fix Jira dependencies: ${result.error.message}`);
					}

					return handleApiResult(result, log, 'Error fixing Jira dependencies');
				} catch (error) {
					log.error(`Error in fix_dependencies tool: ${error.message}`);
					return createErrorResponse(error.message);
				}
			}
		});
	}
}
