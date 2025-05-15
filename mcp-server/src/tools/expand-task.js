/**
 * tools/expand-task.js
 * Tool to expand a task into subtasks
 */

import { z } from 'zod';
import {
	handleApiResult,
	createErrorResponse,
	withNormalizedProjectRoot
} from './utils.js';
import {
	expandTaskDirect,
	expandJiraTaskDirect
} from '../core/task-master-core.js';
import { findTasksJsonPath } from '../core/utils/path-utils.js';
import { JiraClient } from '../core/utils/jira-client.js';
/**
 * Register the expand-task tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerExpandTaskTool(server) {
	if (!JiraClient.isJiraEnabled()) {
		server.addTool({
			name: 'expand_task',
			description: 'Expand a task into subtasks for detailed implementation',
			parameters: z.object({
				id: z.string().describe('ID of task to expand'),
				num: z.string().optional().describe('Number of subtasks to generate'),
				research: z
					.boolean()
					.optional()
					.default(false)
					.describe('Use research role for generation'),
				prompt: z
					.string()
					.optional()
					.describe('Additional context for subtask generation'),
				file: z
					.string()
					.optional()
					.describe(
						'Path to the tasks file relative to project root (e.g., tasks/tasks.json)'
					),
				projectRoot: z
					.string()
					.describe('The directory of the project. Must be an absolute path.'),
				force: z
					.boolean()
					.optional()
					.default(false)
					.describe('Force expansion even if subtasks exist')
			}),
			execute: withNormalizedProjectRoot(async (args, { log, session }) => {
				try {
					log.info(`Starting expand-task with args: ${JSON.stringify(args)}`);

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

					const result = await expandTaskDirect(
						{
							tasksJsonPath: tasksJsonPath,
							id: args.id,
							num: args.num,
							research: args.research,
							prompt: args.prompt,
							force: args.force,
							projectRoot: args.projectRoot
						},
						log,
						{ session }
					);

					return handleApiResult(result, log, 'Error expanding task');
				} catch (error) {
					log.error(`Error in expand-task tool: ${error.message}`);
					return createErrorResponse(error.message);
				}
			})
		});
	} else {
		server.addTool({
			name: 'expand_jira_task',
			description:
				'Expand a jira task into jira subtasks for detailed implementation',
			parameters: z.object({
				id: z
					.string()
					.describe(
						'ID of task to expand (Important: Make sure to include the project prefix, e.g. PROJ-123)'
					),
				num: z.string().optional().describe('Number of subtasks to generate'),
				research: z
					.boolean()
					.optional()
					.describe('Use Perplexity AI for research-backed generation'),
				prompt: z
					.string()
					.optional()
					.describe('Additional context for subtask generation'),
				force: z.boolean().optional().describe('Force the expansion')
			}),
			execute: async (args, { log, session }) => {
				try {
					log.info(`Starting expand-task with args: ${JSON.stringify(args)}`);

					// Get project root from args or session

					// Call direct function with only session in the context, not reportProgress
					// Use the pattern recommended in the MCP guidelines
					const result = await expandJiraTaskDirect(
						{
							id: args.id,
							num: args.num,
							research: args.research,
							prompt: args.prompt,
							force: args.force // Need to add force to parameters
						},
						log,
						{ session }
					); // Only pass session, NOT reportProgress

					// Return the result
					return handleApiResult(result, log, 'Error expanding task');
				} catch (error) {
					log.error(`Error in expand task tool: ${error.message}`);
					return createErrorResponse(error.message);
				}
			}
		});
	}
}
