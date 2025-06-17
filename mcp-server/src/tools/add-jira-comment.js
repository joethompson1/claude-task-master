/**
 * add-jira-comment.js
 *
 * Tool to add a comment to a Jira issue
 */

import { z } from 'zod';
import { JiraClient } from '../core/utils/jira-client.js';
import { addJiraCommentDirect } from '../core/task-master-core.js';
import { handleApiResult, createErrorResponse } from './utils.js';

/**
 * Register the add_jira_comment tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerAddJiraCommentTool(server) {
	// Only register if Jira is enabled
	if (!JiraClient.isJiraEnabled()) {
		return;
	}

	server.addTool({
		name: 'add_jira_comment',
		description: 'Add a comment to a Jira issue',
		parameters: z.object({
			id: z.string().describe("Jira issue key (e.g., 'PROJ-123')"),
			comment: z.string().describe('Comment text to add to the Jira issue')
		}),
		execute: async (args, { log, session }) => {
			try {
				// Extract required parameters
				const { id, comment } = args;

				// Check required parameters
				if (!id) {
					return createErrorResponse('Jira issue ID is required');
				}

				if (!comment) {
					return createErrorResponse('Comment text is required');
				}

				log.info(`Adding comment to Jira issue ${id}`);

				// Call the direct function to add the comment
				const result = await addJiraCommentDirect(
					{
						id,
						comment
					},
					log,
					{ session }
				);

				return handleApiResult(result, log);
			} catch (error) {
				log.error(`Error in add_jira_comment tool: ${error.message}`);
				return createErrorResponse(
					`Failed to add comment to Jira issue: ${error.message}`
				);
			}
		}
	});
}
