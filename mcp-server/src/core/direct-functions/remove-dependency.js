/**
 * Direct function wrapper for removeDependency
 */

import { removeDependency } from '../../../../scripts/modules/dependency-manager.js';
import {
	enableSilentMode,
	disableSilentMode
} from '../../../../scripts/modules/utils.js';
import { JiraClient } from '../utils/jira-client.js';

/**
 * Remove a dependency from a task
 * @param {Object} args - Function arguments
 * @param {string} args.tasksJsonPath - Explicit path to the tasks.json file.
 * @param {string|number} args.id - Task ID to remove dependency from
 * @param {string|number} args.dependsOn - Task ID to remove as a dependency
 * @param {Object} log - Logger object
 * @returns {Promise<{success: boolean, data?: Object, error?: {code: string, message: string}}>}
 */
export async function removeDependencyDirect(args, log) {
	// Destructure expected args
	const { tasksJsonPath, id, dependsOn } = args;
	try {
		log.info(`Removing dependency with args: ${JSON.stringify(args)}`);

		// Check if tasksJsonPath was provided
		if (!tasksJsonPath) {
			log.error('removeDependencyDirect called without tasksJsonPath');
			return {
				success: false,
				error: {
					code: 'MISSING_ARGUMENT',
					message: 'tasksJsonPath is required'
				}
			};
		}

		// Validate required parameters
		if (!id) {
			return {
				success: false,
				error: {
					code: 'INPUT_VALIDATION_ERROR',
					message: 'Task ID (id) is required'
				}
			};
		}

		if (!dependsOn) {
			return {
				success: false,
				error: {
					code: 'INPUT_VALIDATION_ERROR',
					message: 'Dependency ID (dependsOn) is required'
				}
			};
		}

		// Use provided path
		const tasksPath = tasksJsonPath;

		// Format IDs for the core function
		const taskId =
			id && id.includes && id.includes('.') ? id : parseInt(id, 10);
		const dependencyId =
			dependsOn && dependsOn.includes && dependsOn.includes('.')
				? dependsOn
				: parseInt(dependsOn, 10);

		log.info(
			`Removing dependency: task ${taskId} no longer depends on ${dependencyId}`
		);

		// Enable silent mode to prevent console logs from interfering with JSON response
		enableSilentMode();

		// Call the core function using the provided tasksPath
		await removeDependency(tasksPath, taskId, dependencyId);

		// Restore normal logging
		disableSilentMode();

		return {
			success: true,
			data: {
				message: `Successfully removed dependency: Task ${taskId} no longer depends on ${dependencyId}`,
				taskId: taskId,
				dependencyId: dependencyId
			}
		};
	} catch (error) {
		// Make sure to restore normal logging even if there's an error
		disableSilentMode();

		log.error(`Error in removeDependencyDirect: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'CORE_FUNCTION_ERROR',
				message: error.message
			}
		};
	}
}

/**
 * Direct function wrapper for removing a Jira dependency with error handling.
 *
 * @param {Object} args - Command arguments
 * @param {string} args.id - Jira issue key to remove dependency from (e.g., 'PROJ-123')
 * @param {string} args.dependsOn - Jira issue key to remove as a dependency (e.g., 'PROJ-456')
 * @param {Object} log - Logger object
 * @param {Object} context - Execution context
 * @param {Object} context.session - Session information including authentication
 * @returns {Promise<Object>} - Result object with success status and data/error information
 */
export async function removeJiraDependencyDirect(args, log, context = {}) {
	// Destructure expected args and context
	const { id, dependsOn } = args;
	const { session } = context;
	
	try {
		log.info(`Removing Jira dependency with args: ${JSON.stringify(args)}`);

		// Validate required parameters
		if (!id) {
			return {
				success: false,
				error: {
					code: 'INPUT_VALIDATION_ERROR',
					message: 'Jira issue key (id) is required'
				}
			};
		}

		if (!dependsOn) {
			return {
				success: false,
				error: {
					code: 'INPUT_VALIDATION_ERROR',
					message: 'Dependency issue key (dependsOn) is required'
				}
			};
		}

		// Initialize Jira client
		const jiraClient = new JiraClient();
		if (!jiraClient.isReady()) {
			return {
				success: false,
				error: {
					code: 'JIRA_NOT_ENABLED',
					message: 'Jira integration is not properly configured'
				}
			};
		}

		log.info(`Removing dependency: Jira issue ${id} will no longer depend on ${dependsOn}`);

		// Enable silent mode to prevent console logs from interfering with JSON response
		enableSilentMode();

		try {
			// First, need to find the issue link ID between the two issues
			const client = jiraClient.getClient();
			
			// Get the issue with its links
			const issueResponse = await client.get(`/rest/api/3/issue/${id}`, {
				params: {
					fields: 'issuelinks'
				}
			});
			
			// Find the specific link to remove
			const issueLinks = issueResponse.data?.fields?.issuelinks || [];
			let linkIdToRemove = null;
			
			// Check all links to find the one that matches our dependency
			for (const link of issueLinks) {
				// Check if this is our dependency (can be inward or outward link)
				if (
					(link.inwardIssue && link.inwardIssue.key === dependsOn) || 
					(link.outwardIssue && link.outwardIssue.key === dependsOn)
				) {
					linkIdToRemove = link.id;
					break;
				}
			}
			
			// If no matching link was found
			if (!linkIdToRemove) {
				disableSilentMode();
				return {
					success: false,
					error: {
						code: 'DEPENDENCY_NOT_FOUND',
						message: `No dependency link found between issues ${id} and ${dependsOn}`
					}
				};
			}
			
			// Delete the link
			await client.delete(`/rest/api/3/issueLink/${linkIdToRemove}`);

			// Restore normal logging
			disableSilentMode();

			return {
				success: true,
				data: {
					message: `Successfully removed dependency: Jira issue ${id} no longer depends on ${dependsOn}`,
					taskId: id,
					dependencyId: dependsOn
				}
			};
		} catch (error) {
			// Handle errors from Jira API
			disableSilentMode();

			// Special handling for 404 errors (issue not found)
			if (error.response && error.response.status === 404) {
				return {
					success: false,
					error: {
						code: 'JIRA_ISSUE_NOT_FOUND',
						message: `One or both of the specified Jira issues could not be found: ${error.message}`
					}
				};
			}

			// Handle other Jira API errors
			return {
				success: false,
				error: {
					code: 'JIRA_API_ERROR',
					message: `Error removing dependency link in Jira: ${error.message}`,
					details: error.response?.data
				}
			};
		}
	} catch (error) {
		// Make sure to restore normal logging even if there's an error
		if (disableSilentMode) {
			disableSilentMode();
		}

		log.error(`Error in removeJiraDependencyDirect: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'CORE_FUNCTION_ERROR',
				message: error.message
			}
		};
	}
}
