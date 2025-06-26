/**
 * show-task.js
 * Direct function implementation for showing task details
 */

import { findTaskById, readJSON } from '../../../../scripts/modules/utils.js';
import { getCachedOrExecute } from '../../tools/utils.js';
import {
	enableSilentMode,
	disableSilentMode
} from '../../../../scripts/modules/utils.js';
import { findTasksJsonPath } from '../utils/path-utils.js';
import { fetchJiraTaskDetails } from '../utils/jira-utils.js';

/**
 * Direct function wrapper for getting task details.
 *
 * @param {Object} args - Command arguments.
 * @param {string} args.id - Task ID to show.
 * @param {string} [args.file] - Optional path to the tasks file (passed to findTasksJsonPath).
 * @param {string} [args.status] - Optional status to filter subtasks by.
 * @param {string} args.projectRoot - Absolute path to the project root directory (already normalized by tool).
 * @param {Object} log - Logger object.
 * @param {Object} context - Context object containing session data.
 * @returns {Promise<Object>} - Result object with success status and data/error information.
 */
export async function showTaskDirect(args, log) {
	// Destructure session from context if needed later, otherwise ignore
	// const { session } = context;
	// Destructure projectRoot and other args. projectRoot is assumed normalized.
	const { id, file, status, projectRoot } = args;

	log.info(
		`Showing task direct function. ID: ${id}, File: ${file}, Status Filter: ${status}, ProjectRoot: ${projectRoot}`
	);

	// --- Path Resolution using the passed (already normalized) projectRoot ---
	let tasksJsonPath;
	try {
		// Use the projectRoot passed directly from args
		tasksJsonPath = findTasksJsonPath(
			{ projectRoot: projectRoot, file: file },
			log
		);
		log.info(`Resolved tasks path: ${tasksJsonPath}`);
	} catch (error) {
		log.error(`Error finding tasks.json: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'TASKS_FILE_NOT_FOUND',
				message: `Failed to find tasks.json: ${error.message}`
			}
		};
	}
	// --- End Path Resolution ---

	// --- Rest of the function remains the same, using tasksJsonPath ---
	try {
		const tasksData = readJSON(tasksJsonPath);
		if (!tasksData || !tasksData.tasks) {
			return {
				success: false,
				error: { code: 'INVALID_TASKS_DATA', message: 'Invalid tasks data' }
			};
		}

		const { task, originalSubtaskCount } = findTaskById(
			tasksData.tasks,
			id,
			status
		);

		if (!task) {
			return {
				success: false,
				error: {
					code: 'TASK_NOT_FOUND',
					message: `Task or subtask with ID ${id} not found`
				}
			};
		}

		log.info(`Successfully retrieved task ${id}.`);

		const returnData = { ...task };
		if (originalSubtaskCount !== null) {
			returnData._originalSubtaskCount = originalSubtaskCount;
			returnData._subtaskFilter = status;
		}

		return { success: true, data: returnData };
	} catch (error) {
		log.error(`Error showing task ${id}: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'TASK_OPERATION_ERROR',
				message: error.message
			}
		};
	}
}

/**
 * Direct function wrapper for showing Jira task details with error handling.
 *
 * @param {Object} args - Command arguments
 * @param {string} args.id - The Jira issue key to show details for.
 * @param {boolean} [args.withSubtasks=false] - If true, will fetch subtasks for the parent task
 * @param {boolean} [args.includeImages=true] - If true, will fetch and include image attachments
 * @param {boolean} [args.includeContext=false] - If true, will include related tickets and PR context
 * @param {number} [args.maxRelatedTickets=10] - Maximum number of related tickets to fetch in context
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} - Task details result { success: boolean, data?: any, error?: { code: string, message: string } }
 */
export async function showJiraTaskDirect(args, log) {
	// Destructure expected args
	const {
		id,
		includeImages = true,
		includeContext = false,
		withSubtasks = false,
		maxRelatedTickets = 10
	} = args;

	// Validate task ID
	const taskId = id;
	if (!taskId) {
		log.error('Task ID is required');
		return {
			success: false,
			error: {
				code: 'INPUT_VALIDATION_ERROR',
				message: 'Task ID is required'
			}
		};
	}

	try {
		// Enable silent mode to prevent console logs from interfering with JSON response
		enableSilentMode();

		log.info(
			`Retrieving task details for Jira issue: ${taskId}${includeImages === false ? ' (excluding images)' : ''}`
		);

		// Use the dedicated function from jira-utils.js to fetch task details
		const jiraTaskResult = await fetchJiraTaskDetails(
			taskId,
			withSubtasks,
			log,
			{ includeImages, includeContext, maxRelatedTickets, maxTokens: 40000 }
		);

		// Restore normal logging before returning
		disableSilentMode();

		// Return the result directly as it's already in the expected format
		log.info(`showJiraTaskDirect completed for issue: ${taskId}`);
		return jiraTaskResult;
	} catch (error) {
		// Make sure to restore normal logging even if there's an error
		disableSilentMode();

		log.error(`Error showing Jira task: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'CORE_FUNCTION_ERROR',
				message: error.message || 'Failed to show Jira task details'
			}
		};
	}
}
