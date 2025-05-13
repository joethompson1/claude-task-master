/**
 * tools/add-dependency.js
 * Tool for adding a dependency to a task
 */

import { z } from 'zod';
import {
	handleApiResult,
	createErrorResponse,
	getProjectRootFromSession
} from './utils.js';
import { addDependencyDirect, addJiraDependencyDirect } from '../core/task-master-core.js';
import { findTasksJsonPath } from '../core/utils/path-utils.js';
import { JiraClient } from '../core/utils/jira-client.js';

/**
 * Register the addDependency tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerAddDependencyTool(server) {
	if (!JiraClient.isJiraEnabled()) {
		server.addTool({
			name: 'add_dependency',
			description: 'Add a dependency relationship between two tasks',
			parameters: z.object({
				id: z.string().describe('ID of task that will depend on another task'),
				dependsOn: z
					.string()
					.describe('ID of task that will become a dependency'),
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
						`Adding dependency for task ${args.id} to depend on ${args.dependsOn}`
					);
	
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
	
					// Call the direct function with the resolved path
					const result = await addDependencyDirect(
						{
							// Pass the explicitly resolved path
							tasksJsonPath: tasksJsonPath,
							// Pass other relevant args
							id: args.id,
							dependsOn: args.dependsOn
						},
						log
						// Remove context object
					);
	
					// Log result
					if (result.success) {
						log.info(`Successfully added dependency: ${result.data.message}`);
					} else {
						log.error(`Failed to add dependency: ${result.error.message}`);
					}
	
					// Use handleApiResult to format the response
					return handleApiResult(result, log, 'Error adding dependency');
				} catch (error) {
					log.error(`Error in addDependency tool: ${error.message}`);
					return createErrorResponse(error.message);
				}
			})
		});
	} else {
		server.addTool({
			name: 'add_jira_dependency',
			description: 'Add a dependency relationship between two Jira issues',
			parameters: z.object({
				id: z.string().describe('Jira issue key that will depend on another issue (e.g., PROJ-123)'),
				dependsOn: z
					.string()
					.describe('Jira issue key that will become a dependency (e.g., PROJ-456)')
			}),
			execute: async (args, { log, session }) => {
				try {
					log.info(
						`Adding Jira dependency for issue ${args.id} to depend on ${args.dependsOn}`
					);

					const result = await addJiraDependencyDirect(
						{
							id: args.id,
							dependsOn: args.dependsOn
						},
						log,
						{ session }
					);

					// Log result
					if (result.success) {
						log.info(`Successfully added Jira dependency: ${result.data.message}`);
					} else {
						log.error(`Failed to add Jira dependency: ${result.error.message}`);
					}

					// Use handleApiResult to format the response
					return handleApiResult(result, log, 'Error adding Jira dependency');
				} catch (error) {
					log.error(`Error in add_dependency tool: ${error.message}`);
					return createErrorResponse(error.message);
				}
			}
		});
	}
}
