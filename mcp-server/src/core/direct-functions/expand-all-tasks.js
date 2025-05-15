/**
 * Direct function wrapper for expandAllTasks
 */

import { expandAllTasks } from '../../../../scripts/modules/task-manager.js';
import {
	enableSilentMode,
	disableSilentMode,
	isSilentMode
} from '../../../../scripts/modules/utils.js';
import { createLogWrapper } from '../../tools/utils.js';
import { JiraClient } from '../utils/jira-client.js';
import { fetchTasksFromJira, expandJiraTask } from '../utils/jira-utils.js';

/**
 * Expand all pending tasks with subtasks (Direct Function Wrapper)
 * @param {Object} args - Function arguments
 * @param {string} args.tasksJsonPath - Explicit path to the tasks.json file.
 * @param {number|string} [args.num] - Number of subtasks to generate
 * @param {boolean} [args.research] - Enable research-backed subtask generation
 * @param {string} [args.prompt] - Additional context to guide subtask generation
 * @param {boolean} [args.force] - Force regeneration of subtasks for tasks that already have them
 * @param {string} [args.projectRoot] - Project root path.
 * @param {Object} log - Logger object from FastMCP
 * @param {Object} context - Context object containing session
 * @returns {Promise<{success: boolean, data?: Object, error?: {code: string, message: string}}>}
 */
export async function expandAllTasksDirect(args, log, context = {}) {
	const { session } = context; // Extract session
	// Destructure expected args, including projectRoot
	const { tasksJsonPath, num, research, prompt, force, projectRoot } = args;

	// Create logger wrapper using the utility
	const mcpLog = createLogWrapper(log);

	if (!tasksJsonPath) {
		log.error('expandAllTasksDirect called without tasksJsonPath');
		return {
			success: false,
			error: {
				code: 'MISSING_ARGUMENT',
				message: 'tasksJsonPath is required'
			}
		};
	}

	enableSilentMode(); // Enable silent mode for the core function call
	try {
		log.info(
			`Calling core expandAllTasks with args: ${JSON.stringify({ num, research, prompt, force, projectRoot })}`
		);

		// Parse parameters (ensure correct types)
		const numSubtasks = num ? parseInt(num, 10) : undefined;
		const useResearch = research === true;
		const additionalContext = prompt || '';
		const forceFlag = force === true;

		// Call the core function, passing options and the context object { session, mcpLog, projectRoot }
		const result = await expandAllTasks(
			tasksJsonPath,
			numSubtasks,
			useResearch,
			additionalContext,
			forceFlag,
			{ session, mcpLog, projectRoot }
		);

		// Core function now returns a summary object
		return {
			success: true,
			data: {
				message: `Expand all operation completed. Expanded: ${result.expandedCount}, Failed: ${result.failedCount}, Skipped: ${result.skippedCount}`,
				details: result // Include the full result details
			}
		};
	} catch (error) {
		// Log the error using the MCP logger
		log.error(`Error during core expandAllTasks execution: ${error.message}`);
		// Optionally log stack trace if available and debug enabled
		// if (error.stack && log.debug) { log.debug(error.stack); }

		return {
			success: false,
			error: {
				code: 'CORE_FUNCTION_ERROR', // Or a more specific code if possible
				message: error.message
			}
		};
	} finally {
		disableSilentMode(); // IMPORTANT: Ensure silent mode is always disabled
	}
}

/**
 * Expand all pending Jira tasks with subtasks
 * @param {Object} args - Function arguments
 * @param {string} [args.parentKey] - Parent Jira issue key to filter tasks
 * @param {number|string} [args.num] - Number of subtasks to generate
 * @param {boolean} [args.research] - Enable Perplexity AI for research-backed subtask generation
 * @param {string} [args.prompt] - Additional context to guide subtask generation
 * @param {boolean} [args.force] - Force regeneration of subtasks for tasks that already have them
 * @param {Object} log - Logger object
 * @param {Object} context - Context object containing session
 * @returns {Promise<{success: boolean, data?: Object, error?: {code: string, message: string}}>}
 */
export async function expandAllJiraTasksDirect(args, log, context = {}) {
	const { session } = context; // Only extract session, not reportProgress
	// Destructure expected args
	const { parentKey, num, research, prompt, force } = args;

	try {
		log.info(`Expanding all Jira tasks with args: ${JSON.stringify(args)}`);

		// Verify Jira is enabled and properly configured
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

		// Enable silent mode early to prevent any console output
		enableSilentMode();

		try {
			// Parse parameters
			const numSubtasks = num ? parseInt(num, 10) : undefined;
			const useResearch = research === true;
			const additionalContext = prompt || '';
			const forceFlag = force === true;

			log.info(
				`Expanding all Jira tasks with ${numSubtasks || 'default'} subtasks each...`
			);

			if (additionalContext) {
				log.info(`Additional context: "${additionalContext}"`);
			}
			if (forceFlag) {
				log.info('Force regeneration of subtasks is enabled');
			}

			// Fetch all relevant tasks from Jira
			log.info(
				`Fetching tasks from Jira ${parentKey ? `for parent ${parentKey}` : ''}`
			);
			const tasksResult = await fetchTasksFromJira(parentKey, true, log);

			if (!tasksResult.success) {
				return {
					success: false,
					error: {
						code: 'JIRA_FETCH_ERROR',
						message:
							tasksResult.error?.message || 'Failed to fetch tasks from Jira'
					}
				};
			}

			// Filter for pending tasks without subtasks (or with subtasks if force is true)
			const eligibleTasks = tasksResult.tasks.filter((task) => {
				// Only consider pending or in-progress tasks
				const hasValidStatus = ['pending', 'in-progress'].includes(
					task.status?.toLowerCase() || 'pending'
				);
				// Check for existing subtasks
				const hasSubtasks = task.subtasks && task.subtasks.length > 0;
				// Task is eligible if:
				// 1. It has valid status AND
				// 2. Either it has no subtasks OR force flag is set
				return hasValidStatus && (!hasSubtasks || forceFlag);
			});

			log.info(
				`Found ${eligibleTasks.length} eligible tasks to expand out of ${tasksResult.tasks.length} total tasks`
			);

			if (eligibleTasks.length === 0) {
				return {
					success: true,
					data: {
						message: 'No eligible tasks found for expansion',
						details: {
							numSubtasks: numSubtasks,
							research: useResearch,
							prompt: additionalContext,
							force: forceFlag,
							tasksExpanded: 0,
							totalTasks: tasksResult.tasks.length,
							totalEligibleTasks: 0
						}
					}
				};
			}

			// Create a logger wrapper to pass to expandJiraTask
			const logWrapper = {
				info: (message) => log.info(message),
				warn: (message) => log.warn(message),
				error: (message) => log.error(message),
				debug: (message) => log.debug && log.debug(message),
				success: (message) => log.info(message)
			};

			// Process each eligible task
			const expandResults = [];
			let successCount = 0;
			let failureCount = 0;

			for (const task of eligibleTasks) {
				try {
					log.info(`Expanding task: ${task.id} - ${task.title}`);

					// Call expandJiraTask with suitable options
					const expandResult = await expandJiraTask(
						task.id,
						numSubtasks,
						useResearch,
						additionalContext,
						{
							mcpLog: logWrapper,
							session,
							force: forceFlag
						}
					);

					if (expandResult.success) {
						successCount++;
						expandResults.push({
							taskId: task.id,
							success: true,
							subtasksAdded: expandResult.data.subtasksCount || 0
						});
					} else {
						failureCount++;
						expandResults.push({
							taskId: task.id,
							success: false,
							error: expandResult.error?.message || 'Unknown error'
						});
					}
				} catch (taskError) {
					failureCount++;
					log.error(`Error expanding task ${task.id}: ${taskError.message}`);
					expandResults.push({
						taskId: task.id,
						success: false,
						error: taskError.message
					});
				}
			}

			return {
				success: successCount > 0,
				data: {
					message: `Successfully expanded ${successCount} out of ${eligibleTasks.length} Jira tasks`,
					details: {
						numSubtasks: numSubtasks,
						research: useResearch,
						prompt: additionalContext,
						force: forceFlag,
						tasksExpanded: successCount,
						tasksFailed: failureCount,
						totalEligibleTasks: eligibleTasks.length,
						results: expandResults
					}
				}
			};
		} finally {
			// Restore normal logging in finally block to ensure it runs even if there's an error
			disableSilentMode();
		}
	} catch (error) {
		// Ensure silent mode is disabled if an error occurs
		if (isSilentMode()) {
			disableSilentMode();
		}

		log.error(`Error in expandAllJiraTasksDirect: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'JIRA_EXPANSION_ERROR',
				message: error.message
			}
		};
	}
}
