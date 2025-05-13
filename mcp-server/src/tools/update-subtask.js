/**
 * tools/update-subtask.js
 * Tool to append additional information to a specific subtask
 */

import { z } from 'zod';
import {
	handleApiResult,
	createErrorResponse,
	withNormalizedProjectRoot
} from './utils.js';
import { updateSubtaskByIdDirect, updateJiraSubtaskByIdDirect } from '../core/task-master-core.js';
import { findTasksJsonPath } from '../core/utils/path-utils.js';
import { JiraClient } from '../core/utils/jira-client.js';

/**
 * Register the update-subtask tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerUpdateSubtaskTool(server) {
	if (!JiraClient.isJiraEnabled()) {
		server.addTool({
			name: 'update_subtask',
			description:
				'Appends timestamped information to a specific subtask without replacing existing content',
			parameters: z.object({
				id: z
					.string()
					.describe(
						'ID of the subtask to update in format "parentId.subtaskId" (e.g., "5.2"). Parent ID is the ID of the task that contains the subtask.'
					),
				prompt: z.string().describe('Information to add to the subtask'),
				research: z
					.boolean()
					.optional()
					.describe('Use Perplexity AI for research-backed updates'),
				file: z.string().optional().describe('Absolute path to the tasks file'),
				projectRoot: z
					.string()
					.describe('The directory of the project. Must be an absolute path.')
			}),
			execute: withNormalizedProjectRoot(async (args, { log, session }) => {
				const toolName = 'update_subtask';
				try {
					log.info(`Updating subtask with args: ${JSON.stringify(args)}`);
	
					let tasksJsonPath;
					try {
						tasksJsonPath = findTasksJsonPath(
							{ projectRoot: args.projectRoot, file: args.file },
							log
						);
					} catch (error) {
						log.error(`${toolName}: Error finding tasks.json: ${error.message}`);
						return createErrorResponse(
							`Failed to find tasks.json: ${error.message}`
						);
					}
	
					const result = await updateSubtaskByIdDirect(
						{
							tasksJsonPath: tasksJsonPath,
							id: args.id,
							prompt: args.prompt,
							research: args.research,
							projectRoot: args.projectRoot
						},
						log,
						{ session }
					);
	
					if (result.success) {
						log.info(`Successfully updated subtask with ID ${args.id}`);
					} else {
						log.error(
							`Failed to update subtask: ${result.error?.message || 'Unknown error'}`
						);
					}
	
					return handleApiResult(result, log, 'Error updating subtask');
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
			name: 'update_jira_subtask',
			description:
				'Appends timestamped information to a specific Jira subtask without replacing existing content',
			parameters: z.object({
				id: z
					.string()
					.describe(
						"Jira issue key of the subtask to update (e.g., 'PROJ-123')."
					),
				prompt: z.string().describe('A prompt describing the changes to make to a Jira subtask (Be very detailed about which fields of the subtask need to be updated and what changes should be made)'),
				research: z
					.boolean()
					.optional()
					.describe('Use Perplexity AI for research-backed updates'),
				parentKey: z
					.string()
					.optional()
					.describe('Parent Jira issue key if needed to identify the subtask')
			}),
			execute: async (args, { log, session }) => {
				try {
					log.info(`Updating Jira subtask with args: ${JSON.stringify(args)}`);

					const result = await updateJiraSubtaskByIdDirect(
						{
							id: args.id,
							prompt: args.prompt,
							research: args.research,
							parentKey: args.parentKey
						},
						log,
						{ session }
					);

					if (result.success) {
						log.info(`Successfully updated Jira subtask with ID ${args.id}`);
					} else {
						log.error(
							`Failed to update Jira subtask: ${result.error?.message || 'Unknown error'}`
						);
					}

					return handleApiResult(result, log, 'Error updating Jira subtask');
				} catch (error) {
					log.error(`Error in update_jira_subtask tool: ${error.message}`);
					return createErrorResponse(error.message);
				}
			}
		});
	}
}
