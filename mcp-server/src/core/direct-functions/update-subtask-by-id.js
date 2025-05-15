/**
 * update-subtask-by-id.js
 * Direct function implementation for appending information to a specific subtask
 */

import { updateSubtaskById } from '../../../../scripts/modules/task-manager.js';
import { updateJiraIssues } from '../utils/jira-utils.js';
import {
	enableSilentMode,
	disableSilentMode,
	isSilentMode
} from '../../../../scripts/modules/utils.js';
import { createLogWrapper } from '../../tools/utils.js';

/**
 * Direct function wrapper for updateSubtaskById with error handling.
 *
 * @param {Object} args - Command arguments containing id, prompt, useResearch, tasksJsonPath, and projectRoot.
 * @param {string} args.tasksJsonPath - Explicit path to the tasks.json file.
 * @param {string} args.id - Subtask ID in format "parent.sub".
 * @param {string} args.prompt - Information to append to the subtask.
 * @param {boolean} [args.research] - Whether to use research role.
 * @param {string} [args.projectRoot] - Project root path.
 * @param {Object} log - Logger object.
 * @param {Object} context - Context object containing session data.
 * @returns {Promise<Object>} - Result object with success status and data/error information.
 */
export async function updateSubtaskByIdDirect(args, log, context = {}) {
	const { session } = context;
	// Destructure expected args, including projectRoot
	const { tasksJsonPath, id, prompt, research, projectRoot } = args;

	const logWrapper = createLogWrapper(log);

	try {
		logWrapper.info(
			`Updating subtask by ID via direct function. ID: ${id}, ProjectRoot: ${projectRoot}`
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

		// Basic validation for ID format (e.g., '5.2')
		if (!id || typeof id !== 'string' || !id.includes('.')) {
			const errorMessage =
				'Invalid subtask ID format. Must be in format "parentId.subtaskId" (e.g., "5.2").';
			logWrapper.error(errorMessage);
			return {
				success: false,
				error: { code: 'INVALID_SUBTASK_ID', message: errorMessage },
				fromCache: false
			};
		}

		if (!prompt) {
			const errorMessage =
				'No prompt specified. Please provide the information to append.';
			logWrapper.error(errorMessage);
			return {
				success: false,
				error: { code: 'MISSING_PROMPT', message: errorMessage },
				fromCache: false
			};
		}

		// Validate subtask ID format
		const subtaskId = id;
		if (typeof subtaskId !== 'string' && typeof subtaskId !== 'number') {
			const errorMessage = `Invalid subtask ID type: ${typeof subtaskId}. Subtask ID must be a string or number.`;
			log.error(errorMessage);
			return {
				success: false,
				error: { code: 'INVALID_SUBTASK_ID_TYPE', message: errorMessage },
				fromCache: false
			};
		}

		const subtaskIdStr = String(subtaskId);
		if (!subtaskIdStr.includes('.')) {
			const errorMessage = `Invalid subtask ID format: ${subtaskIdStr}. Subtask ID must be in format "parentId.subtaskId" (e.g., "5.2").`;
			log.error(errorMessage);
			return {
				success: false,
				error: { code: 'INVALID_SUBTASK_ID_FORMAT', message: errorMessage },
				fromCache: false
			};
		}

		// Use the provided path
		const tasksPath = tasksJsonPath;
		const useResearch = research === true;

		log.info(
			`Updating subtask with ID ${subtaskIdStr} with prompt "${prompt}" and research: ${useResearch}`
		);

		const wasSilent = isSilentMode();
		if (!wasSilent) {
			enableSilentMode();
		}

		try {
			// Execute core updateSubtaskById function
			const updatedSubtask = await updateSubtaskById(
				tasksPath,
				subtaskIdStr,
				prompt,
				useResearch,
				{ mcpLog: logWrapper, session, projectRoot },
				'json'
			);

			if (updatedSubtask === null) {
				const message = `Subtask ${id} or its parent task not found.`;
				logWrapper.error(message); // Log as error since it couldn't be found
				return {
					success: false,
					error: { code: 'SUBTASK_NOT_FOUND', message: message },
					fromCache: false
				};
			}

			// Subtask updated successfully
			const successMessage = `Successfully updated subtask with ID ${subtaskIdStr}`;
			logWrapper.success(successMessage);
			return {
				success: true,
				data: {
					message: `Successfully updated subtask with ID ${subtaskIdStr}`,
					subtaskId: subtaskIdStr,
					parentId: subtaskIdStr.split('.')[0],
					subtask: updatedSubtask,
					tasksPath,
					useResearch
				},
				fromCache: false
			};
		} catch (error) {
			logWrapper.error(`Error updating subtask by ID: ${error.message}`);
			return {
				success: false,
				error: {
					code: 'UPDATE_SUBTASK_CORE_ERROR',
					message: error.message || 'Unknown error updating subtask'
				},
				fromCache: false
			};
		} finally {
			if (!wasSilent && isSilentMode()) {
				disableSilentMode();
			}
		}
	} catch (error) {
		logWrapper.error(
			`Setup error in updateSubtaskByIdDirect: ${error.message}`
		);
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
 * Direct function wrapper for updateSubtaskById with error handling.
 *
 * @param {Object} args - Command arguments containing id, prompt, useResearch and tasksJsonPath.
 * @param {string} args.id - The ID of the subtask to update.
 * @param {string} args.prompt - The prompt with new information for the subtask update.
 * @param {boolean} args.research - Whether to use Perplexity AI for research-backed updates.
 * @param {Object} log - Logger object.
 * @param {Object} context - Context object containing session data.
 * @returns {Promise<Object>} - Result object with success status and data/error information.
 */
export async function updateJiraSubtaskByIdDirect(args, log, context = {}) {
	const { session } = context; // Only extract session, not reportProgress
	const { id, prompt, research } = args;

	try {
		log.info(`Updating Jira subtask with args: ${JSON.stringify(args)}`);

		// Check required parameters (id and prompt)
		if (!id) {
			const errorMessage =
				'No Jira subtask ID specified. Please provide a Jira subtask ID to update.';
			log.error(errorMessage);
			return {
				success: false,
				error: { code: 'MISSING_SUBTASK_ID', message: errorMessage },
				fromCache: false
			};
		}

		if (!prompt) {
			const errorMessage =
				'No prompt specified. Please provide a prompt with information to add to the Jira subtask.';
			log.error(errorMessage);
			return {
				success: false,
				error: { code: 'MISSING_PROMPT', message: errorMessage },
				fromCache: false
			};
		}

		// Validate subtask ID format
		const subtaskId = id;
		if (typeof subtaskId !== 'string') {
			const errorMessage = `Invalid Jira subtask ID type: ${typeof subtaskId}. Jira subtask ID must be a string.`;
			log.error(errorMessage);
			return {
				success: false,
				error: { code: 'INVALID_SUBTASK_ID_TYPE', message: errorMessage },
				fromCache: false
			};
		}

		// Get research flag
		const useResearch = research === true;

		log.info(
			`Updating Jira subtask with ID ${subtaskId} with prompt "${prompt}" and research: ${useResearch}`
		);

		try {
			// Enable silent mode to prevent console logs from interfering with JSON response
			enableSilentMode();

			// Create a logger wrapper object to handle logging without breaking the mcpLog[level] calls
			// This ensures outputFormat is set to 'json' while still supporting proper logging
			const logWrapper = {
				info: (message) => log.info(message),
				warn: (message) => log.warn(message),
				error: (message) => log.error(message),
				debug: (message) => log.debug && log.debug(message),
				success: (message) => log.info(message) // Map success to info if needed
			};

			const updatedSubtask = await updateJiraIssues(
				subtaskId,
				prompt,
				useResearch,
				{
					session,
					mcpLog: logWrapper
				}
			);

			// Restore normal logging
			disableSilentMode();

			// Handle the case where the subtask couldn't be updated (e.g., already marked as done)
			if (!updatedSubtask) {
				return {
					success: false,
					error: {
						code: 'SUBTASK_UPDATE_FAILED',
						message:
							'Failed to update subtask. It may be marked as completed, or another error occurred.'
					},
					fromCache: false
				};
			}

			// Return the updated subtask information
			return {
				success: true,
				data: {
					message: `Successfully updated subtask with ID ${subtaskId}`,
					subtaskId: subtaskId,
					parentId: subtaskId.split('.')[0],
					subtask: updatedSubtask,
					useResearch
				},
				fromCache: false // This operation always modifies state and should never be cached
			};
		} catch (error) {
			// Make sure to restore normal logging even if there's an error
			disableSilentMode();
			throw error; // Rethrow to be caught by outer catch block
		}
	} catch (error) {
		// Ensure silent mode is disabled
		disableSilentMode();

		log.error(`Error updating subtask by ID: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'UPDATE_SUBTASK_ERROR',
				message: error.message || 'Unknown error updating subtask'
			},
			fromCache: false
		};
	}
}
