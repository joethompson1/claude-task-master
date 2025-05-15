/**
 * tools/update.js
 * Tool to update tasks based on new context/prompt
 */

import { z } from 'zod';
import {
	handleApiResult,
	createErrorResponse,
	withNormalizedProjectRoot
} from './utils.js';
import {
	updateTasksDirect,
	updateJiraTasksDirect
} from '../core/task-master-core.js';
import { findTasksJsonPath } from '../core/utils/path-utils.js';
import { JiraClient } from '../core/utils/jira-client.js';

/**
 * Register the update tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerUpdateTool(server) {
	if (!JiraClient.isJiraEnabled()) {
		server.addTool({
			name: 'update',
			description:
				"Update multiple upcoming tasks (with ID >= 'from' ID) based on new context or changes provided in the prompt. Use 'update_task' instead for a single specific task or 'update_subtask' for subtasks.",
			parameters: z.object({
				from: z
					.string()
					.describe(
						"Task ID from which to start updating (inclusive). IMPORTANT: This tool uses 'from', not 'id'"
					),
				prompt: z
					.string()
					.describe('Explanation of changes or new context to apply'),
				research: z
					.boolean()
					.optional()
					.describe('Use Perplexity AI for research-backed updates'),
				file: z
					.string()
					.optional()
					.describe('Path to the tasks file relative to project root'),
				projectRoot: z
					.string()
					.optional()
					.describe(
						'The directory of the project. (Optional, usually from session)'
					)
			}),
			execute: withNormalizedProjectRoot(async (args, { log, session }) => {
				const toolName = 'update';
				const { from, prompt, research, file, projectRoot } = args;

				try {
					log.info(
						`Executing ${toolName} tool with normalized root: ${projectRoot}`
					);

					let tasksJsonPath;
					try {
						tasksJsonPath = findTasksJsonPath({ projectRoot, file }, log);
						log.info(`${toolName}: Resolved tasks path: ${tasksJsonPath}`);
					} catch (error) {
						log.error(
							`${toolName}: Error finding tasks.json: ${error.message}`
						);
						return createErrorResponse(
							`Failed to find tasks.json within project root '${projectRoot}': ${error.message}`
						);
					}

					const result = await updateTasksDirect(
						{
							tasksJsonPath: tasksJsonPath,
							from: from,
							prompt: prompt,
							research: research,
							projectRoot: projectRoot
						},
						log,
						{ session }
					);

					log.info(
						`${toolName}: Direct function result: success=${result.success}`
					);
					return handleApiResult(result, log, 'Error updating tasks');
				} catch (error) {
					log.error(
						`Critical error in ${toolName} tool execute: ${error.message}`
					);
					return createErrorResponse(
						`Internal tool error (${toolName}): ${error.message}`
					);
				}
			})
		});
	} else {
		server.addTool({
			name: 'update_jira_tasks',
			description:
				"Update specific Jira tasks based on new context or changes provided in the prompt. Use 'update_jira_task' instead for a single specific task or 'update_jira_subtask' for subtasks.",
			parameters: z.object({
				taskIds: z
					.array(z.string())
					.describe(
						"Array of Jira task IDs to update (e.g., ['PROJ-123', 'PROJ-124']), IMPORTANT: Subtask IDs are not supported for this tool, use 'update_jira_subtask' to update subtasks."
					),
				prompt: z
					.string()
					.describe(
						'A prompt describing the changes to make to Jira tasks (Be very detailed about which fields of the task need to be updated and what changes should be made)'
					),
				research: z
					.boolean()
					.optional()
					.describe('Use Perplexity AI for research-backed updates')
			}),
			execute: async (args, { log, session }) => {
				try {
					log.info(
						`Updating specific Jira tasks with args: ${JSON.stringify(args)}`
					);

					// For Jira tasks, we don't need to resolve tasks.json path
					// Instead, we'll directly call the Jira API
					const result = await updateJiraTasksDirect(
						{
							taskIds: args.taskIds,
							prompt: args.prompt,
							research: args.research
						},
						log,
						{ session }
					);

					if (result.success) {
						log.info(
							`Successfully updated ${result.data.results?.length || 0} Jira tasks: ${result.data.message}`
						);
					} else {
						log.error(
							`Failed to update Jira tasks: ${result.error?.message || 'Unknown error'}`
						);
					}

					return handleApiResult(result, log, 'Error updating Jira tasks');
				} catch (error) {
					log.error(`Error in update_jira_tasks tool: ${error.message}`);
					return createErrorResponse(error.message);
				}
			}
		});
	}
}
