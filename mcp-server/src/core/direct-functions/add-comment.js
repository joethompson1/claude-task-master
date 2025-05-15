/**
 * add-comment.js
 *
 * Direct function to add a comment to a Jira issue
 */

import { JiraClient } from '../utils/jira-client.js';
import { enableSilentMode, disableSilentMode } from '../../../../scripts/modules/utils.js';

/**
 * Add a comment to a Jira issue
 * @param {Object} args - Function arguments
 * @param {string} args.id - The Jira issue ID (e.g., "PROJ-123")
 * @param {string} args.comment - The comment text to add
 * @param {Object} log - The logger object
 * @param {Object} context - Additional context information
 * @returns {Promise<Object>} Result with success status and comment data
 */
export async function addJiraCommentDirect(args, log, context = {}) {
	const { id, comment } = args;
	
	try {
		// Verify that required parameters are provided
		if (!id) {
			return {
				success: false,
				error: {
					code: 'JIRA_INVALID_INPUT',
					message: 'Jira issue ID is required'
				},
				fromCache: false
			};
		}

		if (!comment) {
			return {
				success: false,
				error: {
					code: 'JIRA_INVALID_INPUT',
					message: 'Comment text is required'
				},
				fromCache: false
			};
		}

		// Initialize the JiraClient
		const jiraClient = new JiraClient();
		
		// Check if Jira is enabled
		if (!JiraClient.isJiraEnabled()) {
			return {
				success: false,
				error: {
					code: 'JIRA_NOT_ENABLED',
					message: 'Jira integration is not properly configured. Please set the required environment variables.'
				},
				fromCache: false
			};
		}
		
		// Create a logger wrapper to ensure consistent logging format
		const logWrapper = {
			info: (message, ...args) => log.info(message, ...args),
			warn: (message, ...args) => log.warn(message, ...args),
			error: (message, ...args) => log.error(message, ...args),
			debug: (message, ...args) => log.debug && log.debug(message, ...args),
			success: (message, ...args) => log.info(message, ...args)
		};

		// Wrap the Jira client call with silent mode to prevent any unexpected console output
		enableSilentMode();
		try {
			log.info(`Adding comment to Jira issue ${id}`);
			
			// Call the Jira client to add the comment
			const result = await jiraClient.addComment(id, comment, { log: logWrapper });
			
			// Handle potential errors in the response
			if (!result.success) {
				return {
					success: false,
					error: result.error,
					fromCache: false
				};
			}
			
			return {
				success: true,
				data: result.data,
				fromCache: false
			};
		} finally {
			disableSilentMode();
		}
	} catch (error) {
		log.error(`Error adding comment to Jira issue: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'JIRA_COMMENT_ERROR',
				message: `Failed to add comment to Jira issue: ${error.message}`
			},
			fromCache: false
		};
	}
} 