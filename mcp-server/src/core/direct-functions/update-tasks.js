/**
 * update-tasks.js
 * Direct function implementation for updating tasks based on new context
 */

import path from 'path';
import { updateTasks } from '../../../../scripts/modules/task-manager.js';
import { createLogWrapper } from '../../tools/utils.js';
import { updateJiraIssues } from '../utils/jira-utils.js';
/**
 * Direct function wrapper for updating tasks based on new context.
 *
 * @param {Object} args - Command arguments containing projectRoot, from, prompt, research options.
 * @param {Object} log - Logger object.
 * @param {Object} context - Context object containing session data.
 * @returns {Promise<Object>} - Result object with success status and data/error information.
 */
export async function updateTasksDirect(args, log, context = {}) {
	const { session } = context;
	const { from, prompt, research, file: fileArg, projectRoot } = args;

	// Create the standard logger wrapper
	const logWrapper = createLogWrapper(log);

	// --- Input Validation ---
	if (!projectRoot) {
		logWrapper.error('updateTasksDirect requires a projectRoot argument.');
		return {
			success: false,
			error: {
				code: 'MISSING_ARGUMENT',
				message: 'projectRoot is required.'
			}
		};
	}

	if (!from) {
		logWrapper.error('updateTasksDirect called without from ID');
		return {
			success: false,
			error: {
				code: 'MISSING_ARGUMENT',
				message: 'Starting task ID (from) is required'
			}
		};
	}

	if (!prompt) {
		logWrapper.error('updateTasksDirect called without prompt');
		return {
			success: false,
			error: {
				code: 'MISSING_ARGUMENT',
				message: 'Update prompt is required'
			}
		};
	}

	// Resolve tasks file path
	const tasksFile = fileArg
		? path.resolve(projectRoot, fileArg)
		: path.resolve(projectRoot, 'tasks', 'tasks.json');

	logWrapper.info(
		`Updating tasks via direct function. From: ${from}, Research: ${research}, File: ${tasksFile}, ProjectRoot: ${projectRoot}`
	);

	enableSilentMode(); // Enable silent mode
	try {
		// Call the core updateTasks function
		const result = await updateTasks(
			tasksFile,
			from,
			prompt,
			research,
			{
				session,
				mcpLog: logWrapper,
				projectRoot
			},
			'json'
		);

		// updateTasks returns { success: true, updatedTasks: [...] } on success
		if (result && result.success && Array.isArray(result.updatedTasks)) {
			logWrapper.success(
				`Successfully updated ${result.updatedTasks.length} tasks.`
			);
			return {
				success: true,
				data: {
					message: `Successfully updated ${result.updatedTasks.length} tasks.`,
					tasksFile,
					updatedCount: result.updatedTasks.length
				}
			};
		} else {
			// Handle case where core function didn't return expected success structure
			logWrapper.error(
				'Core updateTasks function did not return a successful structure.'
			);
			return {
				success: false,
				error: {
					code: 'CORE_FUNCTION_ERROR',
					message:
						result?.message ||
						'Core function failed to update tasks or returned unexpected result.'
				}
			};
		}
	} catch (error) {
		logWrapper.error(`Error executing core updateTasks: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'UPDATE_TASKS_CORE_ERROR',
				message: error.message || 'Unknown error updating tasks'
			}
		};
	} finally {
		disableSilentMode(); // Ensure silent mode is disabled
	}
}

/**
 * Direct function wrapper for updating tasks based on new context/prompt.
 *
 * @param {Object} args - Command arguments containing fromId, prompt, useResearch and tasksJsonPath.
 * @param {Object} log - Logger object.
 * @param {Object} context - Context object containing session data.
 * @returns {Promise<Object>} - Result object with success status and data/error information.
 */
export async function updateJiraTasksDirect(args, log, context = {}) {
	const { session } = context; // Only extract session, not reportProgress
	const { taskIds, prompt, research } = args;

	try {
		log.info(`Updating Jira tasks with args: ${JSON.stringify(args)}`);

		// Check required parameters
		if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
			const errorMessage =
				'No task IDs specified. Please provide an array of Jira task IDs to update.';
			log.error(errorMessage);
			return {
				success: false,
				error: { code: 'MISSING_TASK_IDS', message: errorMessage },
				fromCache: false
			};
		}

		if (!prompt) {
			const errorMessage =
				'No prompt specified. Please provide a prompt with new context for task updates.';
			log.error(errorMessage);
			return {
				success: false,
				error: { code: 'MISSING_PROMPT', message: errorMessage },
				fromCache: false
			};
		}

		// Get research flag
		const useResearch = research === true;

		log.info(
			`Updating ${taskIds.length} Jira tasks with prompt "${prompt}" and research: ${useResearch}`
		);

		// Create the logger wrapper to ensure compatibility with core functions
		const logWrapper = {
			info: (message, ...args) => log.info(message, ...args),
			warn: (message, ...args) => log.warn(message, ...args),
			error: (message, ...args) => log.error(message, ...args),
			debug: (message, ...args) => log.debug && log.debug(message, ...args), // Handle optional debug
			success: (message, ...args) => log.info(message, ...args) // Map success to info if needed
		};

		try {
			// Enable silent mode to prevent console logs from interfering with JSON response
			enableSilentMode();

			// Execute core updateJiraTasks function, passing the AI client and session
			const result = await updateJiraIssues(taskIds, prompt, useResearch, {
				mcpLog: logWrapper, // Pass the wrapper instead of the raw log object
				session,
				projectRoot
			});

			// Return success message with details from the core function result
			return {
				success: true,
				data: {
					message:
						result.message ||
						`Successfully updated Jira tasks based on the prompt`,
					taskIds,
					updateCount: result.results?.length || 0,
					successCount: result.results?.filter((r) => r.success).length || 0,
					results: result.results || [],
					useResearch
				},
				fromCache: false // This operation always modifies state and should never be cached
			};
		} catch (error) {
			log.error(`Error updating Jira tasks: ${error.message}`);
			return {
				success: false,
				error: {
					code: 'UPDATE_JIRA_TASKS_ERROR',
					message: error.message || 'Unknown error updating Jira tasks'
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

		log.error(`Error updating Jira tasks: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'UPDATE_JIRA_TASKS_ERROR',
				message: error.message || 'Unknown error updating Jira tasks'
			},
			fromCache: false
		};
	}
}
