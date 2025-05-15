/**
 * Direct function wrapper for addSubtask
 */

import { addSubtask } from '../../../../scripts/modules/task-manager.js';
import {
	enableSilentMode,
	disableSilentMode
} from '../../../../scripts/modules/utils.js';
import { createJiraIssue } from '../utils/jira-utils.js';
import { JiraTicket } from '../utils/jira-ticket.js';

/**
 * Add a subtask to an existing task
 * @param {Object} args - Function arguments
 * @param {string} args.tasksJsonPath - Explicit path to the tasks.json file.
 * @param {string} args.id - Parent task ID
 * @param {string} [args.taskId] - Existing task ID to convert to subtask (optional)
 * @param {string} [args.title] - Title for new subtask (when creating a new subtask)
 * @param {string} [args.description] - Description for new subtask
 * @param {string} [args.details] - Implementation details for new subtask
 * @param {string} [args.status] - Status for new subtask (default: 'pending')
 * @param {string} [args.dependencies] - Comma-separated list of dependency IDs
 * @param {boolean} [args.skipGenerate] - Skip regenerating task files
 * @param {Object} log - Logger object
 * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
 */
export async function addSubtaskDirect(args, log) {
	// Destructure expected args
	const {
		tasksJsonPath,
		id,
		taskId,
		title,
		description,
		details,
		status,
		dependencies: dependenciesStr,
		skipGenerate
	} = args;
	try {
		log.info(`Adding subtask with args: ${JSON.stringify(args)}`);

		// Check if tasksJsonPath was provided
		if (!tasksJsonPath) {
			log.error('addSubtaskDirect called without tasksJsonPath');
			return {
				success: false,
				error: {
					code: 'MISSING_ARGUMENT',
					message: 'tasksJsonPath is required'
				}
			};
		}

		if (!id) {
			return {
				success: false,
				error: {
					code: 'INPUT_VALIDATION_ERROR',
					message: 'Parent task ID is required'
				}
			};
		}

		// Either taskId or title must be provided
		if (!taskId && !title) {
			return {
				success: false,
				error: {
					code: 'INPUT_VALIDATION_ERROR',
					message: 'Either taskId or title must be provided'
				}
			};
		}

		// Use provided path
		const tasksPath = tasksJsonPath;

		// Parse dependencies if provided
		let dependencies = [];
		if (dependenciesStr) {
			dependencies = dependenciesStr.split(',').map((depId) => {
				// Handle both regular IDs and dot notation
				return depId.includes('.') ? depId.trim() : parseInt(depId.trim(), 10);
			});
		}

		// Convert existingTaskId to a number if provided
		const existingTaskId = taskId ? parseInt(taskId, 10) : null;

		// Convert parent ID to a number
		const parentId = parseInt(id, 10);

		// Determine if we should generate files
		const generateFiles = !skipGenerate;

		// Enable silent mode to prevent console logs from interfering with JSON response
		enableSilentMode();

		// Case 1: Convert existing task to subtask
		if (existingTaskId) {
			log.info(`Converting task ${existingTaskId} to a subtask of ${parentId}`);
			const result = await addSubtask(
				tasksPath,
				parentId,
				existingTaskId,
				null,
				generateFiles
			);

			// Restore normal logging
			disableSilentMode();

			return {
				success: true,
				data: {
					message: `Task ${existingTaskId} successfully converted to a subtask of task ${parentId}`,
					subtask: result
				}
			};
		}
		// Case 2: Create new subtask
		else {
			log.info(`Creating new subtask for parent task ${parentId}`);

			const newSubtaskData = {
				title: title,
				description: description || '',
				details: details || '',
				status: status || 'pending',
				dependencies: dependencies
			};

			const result = await addSubtask(
				tasksPath,
				parentId,
				null,
				newSubtaskData,
				generateFiles
			);

			// Restore normal logging
			disableSilentMode();

			return {
				success: true,
				data: {
					message: `New subtask ${parentId}.${result.id} successfully created`,
					subtask: result
				}
			};
		}
	} catch (error) {
		// Make sure to restore normal logging even if there's an error
		disableSilentMode();

		log.error(`Error in addSubtaskDirect: ${error.message}`);
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
 * Create a Jira subtask under a specified parent issue
 * @param {Object} args - Function arguments
 * @param {string} args.parentKey - The Jira key of the parent issue (e.g., "PROJ-123")
 * @param {string} args.title - The title/summary for the new subtask
 * @param {string} [args.description] - The description for the subtask
 * @param {string} [args.details] - The implementation details for the subtask
 * @param {string} [args.acceptanceCriteria] - The acceptance criteria for the subtask
 * @param {string} [args.testStrategy] - The test strategy for the subtask
 * @param {string} [args.priority] - Jira priority name (e.g., "Medium", "High")
 * @param {string} [args.assignee] - Jira account ID or email of the assignee
 * @param {string[]} [args.labels] - List of labels to add
 * @param {Object} log - Logger object
 * @param {Object} [context={}] - Additional context (e.g., session)
 * @returns {Promise<Object>} - Result object with success status and data/error
 */
export async function addJiraSubtaskDirect(args, log, context = {}) {
	try {
		// Extract parameters from args
		const {
			parentKey,
			title,
			description,
			details,
			acceptanceCriteria,
			testStrategy,
			priority,
			assignee,
			labels
		} = args;

		// Validate required parameters
		if (!parentKey) {
			return {
				success: false,
				error: {
					code: 'MISSING_PARAMETER',
					message: 'Parent issue key (parentKey) is required'
				}
			};
		}

		if (!title) {
			return {
				success: false,
				error: {
					code: 'MISSING_PARAMETER',
					message: 'Subtask title/summary is required'
				}
			};
		}

		log.info(
			`Creating Jira subtask under parent ${parentKey} with title "${title}"`
		);

		const jiraTicket = new JiraTicket({
			title: title,
			description: description,
			details: details,
			acceptanceCriteria: acceptanceCriteria,
			testStrategy: testStrategy,
			priority: priority,
			assignee: assignee,
			labels: labels,
			parentKey: parentKey,
			issueType: 'Subtask'
		});

		// Call the refactored function with 'Subtask' as the issue type
		const result = await createJiraIssue(jiraTicket, log);

		// Return the result directly
		return result;
	} catch (error) {
		// Log the error
		log.error(`Error in addJiraSubtaskDirect: ${error.message}`);

		// Return structured error response
		return {
			success: false,
			error: {
				code: 'DIRECT_FUNCTION_ERROR',
				message: error.message,
				details: error.stack,
				// Preserve any displayMessage from the error object
				displayMessage: error.error?.displayMessage || error.message
			}
		};
	}
}
