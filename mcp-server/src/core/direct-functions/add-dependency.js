/**
 * add-dependency.js
 * Direct function implementation for adding a dependency to a task
 */

import { addDependency } from '../../../../scripts/modules/dependency-manager.js';
import {
	enableSilentMode,
	disableSilentMode
} from '../../../../scripts/modules/utils.js';
import { JiraClient } from '../utils/jira-client.js';

/**
 * Direct function wrapper for addDependency with error handling.
 *
 * @param {Object} args - Command arguments
 * @param {string} args.tasksJsonPath - Explicit path to the tasks.json file.
 * @param {string|number} args.id - Task ID to add dependency to
 * @param {string|number} args.dependsOn - Task ID that will become a dependency
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} - Result object with success status and data/error information
 */
export async function addDependencyDirect(args, log) {
	// Destructure expected args
	const { tasksJsonPath, id, dependsOn } = args;
	try {
		log.info(`Adding dependency with args: ${JSON.stringify(args)}`);

		// Check if tasksJsonPath was provided
		if (!tasksJsonPath) {
			log.error('addDependencyDirect called without tasksJsonPath');
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
			`Adding dependency: task ${taskId} will depend on ${dependencyId}`
		);

		// Enable silent mode to prevent console logs from interfering with JSON response
		enableSilentMode();

		// Call the core function using the provided path
		await addDependency(tasksPath, taskId, dependencyId);

		// Restore normal logging
		disableSilentMode();

		return {
			success: true,
			data: {
				message: `Successfully added dependency: Task ${taskId} now depends on ${dependencyId}`,
				taskId: taskId,
				dependencyId: dependencyId
			}
		};
	} catch (error) {
		// Make sure to restore normal logging even if there's an error
		disableSilentMode();

		log.error(`Error in addDependencyDirect: ${error.message}`);
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
 * Direct function wrapper for adding a Jira dependency with error handling.
 *
 * @param {Object} args - Command arguments
 * @param {string} args.id - Jira issue key to add dependency to (e.g., 'PROJ-123')
 * @param {string} args.dependsOn - Jira issue key that will become a dependency (e.g., 'PROJ-456')
 * @param {Object} log - Logger object
 * @param {Object} context - Execution context
 * @param {Object} context.session - Session information including authentication
 * @returns {Promise<Object>} - Result object with success status and data/error information
 */
export async function addJiraDependencyDirect(args, log, context = {}) {
	// Destructure expected args and context
	const { id, dependsOn } = args;
	const { session } = context;

	try {
		log.info(`Adding Jira dependency with args: ${JSON.stringify(args)}`);

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

		log.info(`Adding dependency: Jira issue ${id} will depend on ${dependsOn}`);

		// Enable silent mode to prevent console logs from interfering with JSON response
		enableSilentMode();

		try {
			// Create issue link using Jira client
			// The dependent issue (id) "is blocked by" the dependency issue (dependsOn)
			const linkPayload = {
				type: {
					name: 'Blocks' // Common link type - the dependency blocks the dependent issue
				},
				inwardIssue: {
					key: dependsOn
				},
				outwardIssue: {
					key: id
				}
			};

			const client = jiraClient.getClient();
			await client.post('/rest/api/3/issueLink', linkPayload);

			// Restore normal logging
			disableSilentMode();

			return {
				success: true,
				data: {
					message: `Successfully added dependency: Jira issue ${id} now depends on ${dependsOn}`,
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
					message: `Error creating dependency link in Jira: ${error.message}`,
					details: error.response?.data
				}
			};
		}
	} catch (error) {
		// Make sure to restore normal logging even if there's an error
		if (disableSilentMode) {
			disableSilentMode();
		}

		log.error(`Error in addJiraDependencyDirect: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'CORE_FUNCTION_ERROR',
				message: error.message
			}
		};
	}
}
