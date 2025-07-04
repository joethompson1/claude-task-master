/**
 * list-tasks.js
 * Direct function implementation for listing tasks
 */

import { listTasks } from '../../../../scripts/modules/task-manager.js';
import { getCachedOrExecute } from '../../tools/utils.js';
import {
	enableSilentMode,
	disableSilentMode
} from '../../../../scripts/modules/utils.js';
import { JiraClient } from '../utils/jira-client.js';

/**
 * Direct function wrapper for listTasks with error handling and caching.
 *
 * @param {Object} args - Command arguments (now expecting tasksJsonPath explicitly).
 * @param {Object} log - Logger object.
 * @returns {Promise<Object>} - Task list result { success: boolean, data?: any, error?: { code: string, message: string }, fromCache: boolean }.
 */
export async function listTasksDirect(args, log) {
	// Destructure the explicit tasksJsonPath from args
	const { tasksJsonPath, status, withSubtasks, parentKey, includeComments } = args;

	if (!JiraClient.isJiraEnabled() && !tasksJsonPath) {
		log.error(
			'listTasksDirect called without tasksJsonPath and source is not jira'
		);
		return {
			success: false,
			error: {
				code: 'MISSING_ARGUMENT',
				message: 'tasksJsonPath is required when source is not jira'
			},
			fromCache: false
		};
	}

	// Use the explicit tasksJsonPath for cache key (or parentKey for Jira)
	const statusFilter = status || 'all';
	const withSubtasksFilter = withSubtasks || false;
	const includeCommentsFilter = includeComments || false;
	const cacheKey = JiraClient.isJiraEnabled()
		? `listTasks:jira:${parentKey}:${statusFilter}:${withSubtasksFilter}:${includeCommentsFilter}`
		: `listTasks:${tasksJsonPath}:${statusFilter}:${withSubtasksFilter}`;

	// Define the action function to be executed on cache miss
	const coreListTasksAction = async () => {
		try {
			// Enable silent mode to prevent console logs from interfering with JSON response
			enableSilentMode();

			log.info(
				JiraClient.isJiraEnabled()
					? `Executing core listTasks function for Jira parent: ${parentKey}, filter: ${statusFilter}, subtasks: ${withSubtasksFilter}, comments: ${includeCommentsFilter}`
					: `Executing core listTasks function for path: ${tasksJsonPath}, filter: ${statusFilter}, subtasks: ${withSubtasksFilter}`
			);

			// Pass the explicit tasksJsonPath and options to the core function
			const resultData = await listTasks(
				tasksJsonPath,
				statusFilter,
				withSubtasksFilter,
				{
					parentKey: parentKey,
					includeComments: includeCommentsFilter
				},
				'json'
			);

			if (!resultData || !resultData.tasks) {
				log.error('Invalid or empty response from listTasks core function');
				return {
					success: false,
					error: {
						code: 'INVALID_CORE_RESPONSE',
						message: 'Invalid or empty response from listTasks core function'
					}
				};
			}
			log.info(
				`Core listTasks function retrieved ${resultData.tasks.length} tasks from ${JiraClient.isJiraEnabled() ? 'Jira' : 'local'} source`
			);

			// Restore normal logging
			disableSilentMode();

			return { success: true, data: resultData };
		} catch (error) {
			// Make sure to restore normal logging even if there's an error
			disableSilentMode();

			log.error(`Core listTasks function failed: ${error.message}`);
			return {
				success: false,
				error: {
					code: 'LIST_TASKS_CORE_ERROR',
					message: error.message || 'Failed to list tasks'
				}
			};
		}
	};

	// Use the caching utility
	try {
		const result = await getCachedOrExecute({
			cacheKey,
			actionFn: coreListTasksAction,
			log
		});
		log.info(`listTasksDirect completed. From cache: ${result.fromCache}`);
		return result; // Returns { success, data/error, fromCache }
	} catch (error) {
		// Catch unexpected errors from getCachedOrExecute itself (though unlikely)
		log.error(
			`Unexpected error during getCachedOrExecute for listTasks: ${error.message}`,
			error.stack
		);
		// Don't use console.error in MCP mode as it breaks the JSON protocol
		return {
			success: false,
			error: { code: 'CACHE_UTIL_ERROR', message: error.message },
			fromCache: false
		};
	}
}
