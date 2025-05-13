/**
 * update-task-by-id.js
 * Direct function implementation for updating a single task by ID with new information
 */

import { updateTaskById } from '../../../../scripts/modules/task-manager.js';
import {
	enableSilentMode,
	disableSilentMode,
	isSilentMode
} from '../../../../scripts/modules/utils.js';
import { createLogWrapper } from '../../tools/utils.js';
import { updateJiraIssues } from '../utils/jira-utils.js';

/**
 * Direct function wrapper for updateTaskById with error handling.
 *
 * @param {Object} args - Command arguments containing id, prompt, useResearch, tasksJsonPath, and projectRoot.
 * @param {string} args.tasksJsonPath - Explicit path to the tasks.json file.
 * @param {string} args.id - Task ID (or subtask ID like "1.2").
 * @param {string} args.prompt - New information/context prompt.
 * @param {boolean} [args.research] - Whether to use research role.
 * @param {string} [args.projectRoot] - Project root path.
 * @param {Object} log - Logger object.
 * @param {Object} context - Context object containing session data.
 * @returns {Promise<Object>} - Result object with success status and data/error information.
 */
export async function updateTaskByIdDirect(args, log, context = {}) {
	const { session } = context;
	// Destructure expected args, including projectRoot
	const { tasksJsonPath, id, prompt, research, projectRoot } = args;

	const logWrapper = createLogWrapper(log);

	try {
		logWrapper.info(
			`Updating task by ID via direct function. ID: ${id}, ProjectRoot: ${projectRoot}`
		);

		// Check if tasksJsonPath was provided
		if (!tasksJsonPath) {
			const errorMessage = 'tasksJsonPath is required but was not provided.';
			logWrapper.error(errorMessage);
			return {
				success: false,
				error: { code: 'MISSING_ARGUMENT', message: errorMessage },
				fromCache: false
			};
		}

		// Check required parameters (id and prompt)
		if (!id) {
			const errorMessage =
				'No task ID specified. Please provide a task ID to update.';
			logWrapper.error(errorMessage);
			return {
				success: false,
				error: { code: 'MISSING_TASK_ID', message: errorMessage },
				fromCache: false
			};
		}

		if (!prompt) {
			const errorMessage =
				'No prompt specified. Please provide a prompt with new information for the task update.';
			logWrapper.error(errorMessage);
			return {
				success: false,
				error: { code: 'MISSING_PROMPT', message: errorMessage },
				fromCache: false
			};
		}

		// Parse taskId - handle both string and number values
		let taskId;
		if (typeof id === 'string') {
			// Handle subtask IDs (e.g., "5.2")
			if (id.includes('.')) {
				taskId = id; // Keep as string for subtask IDs
			} else {
				// Parse as integer for main task IDs
				taskId = parseInt(id, 10);
				if (isNaN(taskId)) {
					const errorMessage = `Invalid task ID: ${id}. Task ID must be a positive integer or subtask ID (e.g., "5.2").`;
					logWrapper.error(errorMessage);
					return {
						success: false,
						error: { code: 'INVALID_TASK_ID', message: errorMessage },
						fromCache: false
					};
				}
			}
		} else {
			taskId = id;
		}

		// Use the provided path
		const tasksPath = tasksJsonPath;

		// Get research flag
		const useResearch = research === true;

		logWrapper.info(
			`Updating task with ID ${taskId} with prompt "${prompt}" and research: ${useResearch}`
		);

		const wasSilent = isSilentMode();
		if (!wasSilent) {
			enableSilentMode();
		}

		try {
			// Execute core updateTaskById function with proper parameters
			const updatedTask = await updateTaskById(
				tasksPath,
				taskId,
				prompt,
				useResearch,
				{
					mcpLog: logWrapper,
					session,
					projectRoot
				},
				'json'
			);

			// Check if the core function indicated the task wasn't updated (e.g., status was 'done')
			if (updatedTask === null) {
				// Core function logs the reason, just return success with info
				const message = `Task ${taskId} was not updated (likely already completed).`;
				logWrapper.info(message);
				return {
					success: true,
					data: { message: message, taskId: taskId, updated: false },
					fromCache: false
				};
			}

			// Task was updated successfully
			const successMessage = `Successfully updated task with ID ${taskId} based on the prompt`;
			logWrapper.success(successMessage);
			return {
				success: true,
				data: {
					message: successMessage,
					taskId: taskId,
					tasksPath: tasksPath,
					useResearch: useResearch,
					updated: true,
					updatedTask: updatedTask
				},
				fromCache: false
			};
		} catch (error) {
			logWrapper.error(`Error updating task by ID: ${error.message}`);
			return {
				success: false,
				error: {
					code: 'UPDATE_TASK_CORE_ERROR',
					message: error.message || 'Unknown error updating task'
				},
				fromCache: false
			};
		} finally {
			if (!wasSilent && isSilentMode()) {
				disableSilentMode();
			}
		}
	} catch (error) {
		logWrapper.error(`Setup error in updateTaskByIdDirect: ${error.message}`);
		if (isSilentMode()) disableSilentMode();
		return {
			success: false,
			error: {
				code: 'DIRECT_FUNCTION_SETUP_ERROR',
				message: error.message || 'Unknown setup error'
			},
			fromCache: false
		};
	}
}


/**
 * Direct function wrapper for updateTaskById with error handling.
 *
 * @param {Object} args - Command arguments containing id, prompt, useResearch and tasksJsonPath.
 * @param {string} args.id - The ID of the task to update.
 * @param {string} args.prompt - The prompt with new information for the task update.
 * @param {boolean} args.research - Whether to use Perplexity AI for research-backed updates.
 * @param {Object} log - Logger object.
 * @param {Object} context - Context object containing session data.
 * @returns {Promise<Object>} - Result object with success status and data/error information.
 */
export async function updateJiraTaskByIdDirect(args, log, context = {}) {
	const { session } = context; // Only extract session, not reportProgress
	// Destructure expected args
	const { id, prompt, research } = args;

	try {
		log.info(`Updating Jira task with args: ${JSON.stringify(args)}`);

		// Check required parameters (id and prompt)
		if (!id) {
			const errorMessage =
				'No task ID specified. Please provide a task ID to update.';
			log.error(errorMessage);
			return {
				success: false,
				error: { code: 'MISSING_TASK_ID', message: errorMessage },
				fromCache: false
			};
		}

		if (!prompt) {
			const errorMessage =
				'No prompt specified. Please provide a prompt with new information for the task update.';
			log.error(errorMessage);
			return {
				success: false,
				error: { code: 'MISSING_PROMPT', message: errorMessage },
				fromCache: false
			};
		}

		// Parse taskId - handle both string and number values
		let taskId;
		if (typeof id === 'string') {
			// Handle subtask IDs (e.g., "PROJ-123")
			if (id.includes('-')) {
				taskId = id;
			} else {
				const errorMessage =
				'Task ID must be in the format "PROJ-123"';
				log.error(errorMessage);
				return {
					success: false,
					error: { code: 'INVALID_TASK_ID', message: errorMessage },
					fromCache: false
				};
			}
		} else {
			taskId = id;
		}

		// Get research flag
		const useResearch = research === true;

		// Initialize appropriate AI client based on research flag
		let aiClient;
		try {
			if (useResearch) {
				log.info('Using Perplexity AI for research-backed task update');
				aiClient = await getPerplexityClientForMCP(session, log);
			} else {
				log.info('Using Claude AI for task update');
				aiClient = getAnthropicClientForMCP(session, log);
			}
		} catch (error) {
			log.error(`Failed to initialize AI client: ${error.message}`);
			return {
				success: false,
				error: {
					code: 'AI_CLIENT_ERROR',
					message: `Cannot initialize AI client: ${error.message}`
				},
				fromCache: false
			};
		}

		log.info(
			`Updating task with ID ${taskId} with prompt "${prompt}" and research: ${useResearch}`
		);

		try {
			// Enable silent mode to prevent console logs from interfering with JSON response
			enableSilentMode();

			// Create a logger wrapper that matches what updateTaskById expects
			const logWrapper = {
				info: (message) => log.info(message),
				warn: (message) => log.warn(message),
				error: (message) => log.error(message),
				debug: (message) => log.debug && log.debug(message),
				success: (message) => log.info(message) // Map success to info since many loggers don't have success
			};

			// Execute core updateTaskById function with proper parameters
			const result = await updateJiraIssues(
				taskId,
				prompt,
				useResearch,
				{
					mcpLog: logWrapper, // Use our wrapper object that has the expected method structure
					session
				},
				'json'
			);

			// Handle the case where the task couldn't be updated (e.g., already marked as done)
			if (!result) {
				throw new Error('Failed to update Jira task. It may be marked as completed, or another error occurred.');
			}

			return result;

		} catch (error) {
			log.error(`Error updating task by ID: ${error.message}`);
			return {
				success: false,
				error: {
					code: 'UPDATE_TASK_ERROR',
					message: error.message || 'Unknown error updating task'
				},
				fromCache: false
			};
		} finally {
			// Make sure to restore normal logging even if there's an error
			disableSilentMode();
		}
	} catch (error) {
		// Ensure silent mode is disabled
		disableSilentMode();

		log.error(`Error updating task by ID: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'UPDATE_TASK_ERROR',
				message: error.message || 'Unknown error updating task'
			},
			fromCache: false
		};
	}
}