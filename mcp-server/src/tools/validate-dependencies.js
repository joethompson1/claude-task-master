/**
 * tools/validate-dependencies.js
 * Tool for validating task dependencies
 */

import { z } from 'zod';
import {
	handleApiResult,
	createErrorResponse,
	withNormalizedProjectRoot
} from './utils.js';
import {
	validateDependenciesDirect,
	validateJiraDependenciesDirect
} from '../core/task-master-core.js';
import { findTasksJsonPath } from '../core/utils/path-utils.js';
import { JiraClient } from '../core/utils/jira-client.js';

/**
 * Register the validateDependencies tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerValidateDependenciesTool(server) {
	if (!JiraClient.isJiraEnabled()) {
		server.addTool({
			name: 'validate_dependencies',
			description:
				'Check tasks for dependency issues (like circular references or links to non-existent tasks) without making changes.',
			parameters: z.object({
				file: z.string().optional().describe('Absolute path to the tasks file'),
				projectRoot: z
					.string()
					.describe('The directory of the project. Must be an absolute path.')
			}),
			execute: withNormalizedProjectRoot(async (args, { log, session }) => {
				try {
					log.info(
						`Validating dependencies with args: ${JSON.stringify(args)}`
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

					const result = await validateDependenciesDirect(
						{
							tasksJsonPath: tasksJsonPath
						},
						log
					);

					if (result.success) {
						log.info(
							`Successfully validated dependencies: ${result.data.message}`
						);
					} else {
						log.error(
							`Failed to validate dependencies: ${result.error.message}`
						);
					}

					return handleApiResult(result, log, 'Error validating dependencies');
				} catch (error) {
					log.error(`Error in validateDependencies tool: ${error.message}`);
					return createErrorResponse(error.message);
				}
			})
		});
	} else {
		server.addTool({
			name: 'validate_jira_dependencies',
			description:
				'Check Jira issues for dependency issues (like circular references or links to non-existent tasks) without making changes.',
			parameters: z.object({
				parentKey: z
					.string()
					.optional()
					.describe('Parent Jira issue key to filter tasks')
			}),
			execute: async (args, { log, session }) => {
				try {
					log.info(
						`Validating Jira dependencies with args: ${JSON.stringify(args)}`
					);

					const result = await validateJiraDependenciesDirect(
						{
							parentKey: args.parentKey
						},
						log,
						{ session }
					);

					if (result.success) {
						log.info(
							`Successfully validated Jira dependencies: ${result.data.message}`
						);
					} else {
						log.error(
							`Failed to validate Jira dependencies: ${result.error.message}`
						);
					}

					return handleApiResult(
						result,
						log,
						'Error validating Jira dependencies'
					);
				} catch (error) {
					log.error(`Error in validate_dependencies tool: ${error.message}`);
					return createErrorResponse(error.message);
				}
			}
		});
	}
}
