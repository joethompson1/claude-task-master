/**
 * tools/expand-all.js
 * Tool for expanding all pending tasks with subtasks
 */

import { z } from 'zod';
import {
	handleApiResult,
	createErrorResponse,
	withNormalizedProjectRoot
} from './utils.js';
import {
	expandAllTasksDirect,
	expandAllJiraTasksDirect
} from '../core/task-master-core.js';
import { findTasksJsonPath } from '../core/utils/path-utils.js';
import { JiraClient } from '../core/utils/jira-client.js';

/**
 * Register the expandAll tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerExpandAllTool(server) {
	if (!JiraClient.isJiraEnabled()) {
		server.addTool({
			name: 'expand_all',
			description:
				'Expand all pending tasks into subtasks based on complexity or defaults',
			parameters: z.object({
				num: z
					.string()
					.optional()
					.describe(
						'Target number of subtasks per task (uses complexity/defaults otherwise)'
					),
				research: z
					.boolean()
					.optional()
					.describe(
						'Enable research-backed subtask generation (e.g., using Perplexity)'
					),
				prompt: z
					.string()
					.optional()
					.describe(
						'Additional context to guide subtask generation for all tasks'
					),
				force: z
					.boolean()
					.optional()
					.describe(
						'Force regeneration of subtasks for tasks that already have them'
					),
				file: z
					.string()
					.optional()
					.describe(
						'Absolute path to the tasks file in the /tasks folder inside the project root (default: tasks/tasks.json)'
					),
				projectRoot: z
					.string()
					.optional()
					.describe(
						'Absolute path to the project root directory (derived from session if possible)'
					)
			}),
			execute: withNormalizedProjectRoot(async (args, { log, session }) => {
				try {
					log.info(
						`Tool expand_all execution started with args: ${JSON.stringify(args)}`
					);

					let tasksJsonPath;
					try {
						tasksJsonPath = findTasksJsonPath(
							{ projectRoot: args.projectRoot, file: args.file },
							log
						);
						log.info(`Resolved tasks.json path: ${tasksJsonPath}`);
					} catch (error) {
						log.error(`Error finding tasks.json: ${error.message}`);
						return createErrorResponse(
							`Failed to find tasks.json: ${error.message}`
						);
					}

					const result = await expandAllTasksDirect(
						{
							tasksJsonPath: tasksJsonPath,
							num: args.num,
							research: args.research,
							prompt: args.prompt,
							force: args.force,
							projectRoot: args.projectRoot
						},
						log,
						{ session }
					);

					return handleApiResult(result, log, 'Error expanding all tasks');
				} catch (error) {
					log.error(
						`Unexpected error in expand_all tool execute: ${error.message}`
					);
					if (error.stack) {
						log.error(error.stack);
					}
					return createErrorResponse(
						`An unexpected error occurred: ${error.message}`
					);
				}
			})
		});
	} else {
	// 	// Register the Jira-specific version of the expand_all tool
	// 	server.addTool({
	// 		name: 'expand_all_jira',
	// 		description: 'Expand all pending Jira tasks into subtasks',
	// 		parameters: z.object({
	// 			num: z
	// 				.string()
	// 				.optional()
	// 				.describe('Number of subtasks to generate for each task'),
	// 			research: z
	// 				.boolean()
	// 				.optional()
	// 				.describe(
	// 					'Enable Perplexity AI for research-backed subtask generation'
	// 				),
	// 			prompt: z
	// 				.string()
	// 				.optional()
	// 				.describe('Additional context to guide subtask generation'),
	// 			force: z
	// 				.boolean()
	// 				.optional()
	// 				.describe(
	// 					'Force regeneration of subtasks for tasks that already have them'
	// 				),
	// 			parentKey: z
	// 				.string()
	// 				.optional()
	// 				.describe('Parent Jira issue key to filter tasks')
	// 		}),
	// 		execute: async (args, { log, session }) => {
	// 			try {
	// 				log.info(
	// 					`Expanding all Jira tasks with args: ${JSON.stringify(args)}`
	// 				);

	// 				// Call the direct function with only session in context
	// 				const result = await expandAllJiraTasksDirect(
	// 					{
	// 						// Pass relevant args
	// 						parentKey: args.parentKey,
	// 						num: args.num,
	// 						research: args.research,
	// 						prompt: args.prompt,
	// 						force: args.force
	// 					},
	// 					log,
	// 					{ session }
	// 				);

	// 				if (result.success) {
	// 					log.info(
	// 						`Successfully expanded all Jira tasks: ${result.data.message}`
	// 					);
	// 				} else {
	// 					log.error(
	// 						`Failed to expand all Jira tasks: ${result.error?.message || 'Unknown error'}`
	// 					);
	// 				}

	// 				return handleApiResult(result, log, 'Error expanding all Jira tasks');
	// 			} catch (error) {
	// 				log.error(`Error in expand-all-jira tool: ${error.message}`);
	// 				return createErrorResponse(error.message);
	// 			}
	// 		}
	// 	});
	}
}
