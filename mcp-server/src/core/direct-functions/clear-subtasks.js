/**
 * Direct function wrapper for clearSubtasks
 */

import { clearSubtasks } from '../../../../scripts/modules/task-manager.js';
import {
	enableSilentMode,
	disableSilentMode
} from '../../../../scripts/modules/utils.js';
import fs from 'fs';
import { JiraClient } from '../utils/jira-client.js';
import { removeJiraSubtask } from '../utils/jira-utils.js';

/**
 * Clear subtasks from specified tasks
 * @param {Object} args - Function arguments
 * @param {string} args.tasksJsonPath - Explicit path to the tasks.json file.
 * @param {string} [args.id] - Task IDs (comma-separated) to clear subtasks from
 * @param {boolean} [args.all] - Clear subtasks from all tasks
 * @param {Object} log - Logger object
 * @returns {Promise<{success: boolean, data?: Object, error?: {code: string, message: string}}>}
 */
export async function clearSubtasksDirect(args, log) {
	// Destructure expected args
	const { tasksJsonPath, id, all } = args;
	try {
		log.info(`Clearing subtasks with args: ${JSON.stringify(args)}`);

		// Check if tasksJsonPath was provided
		if (!tasksJsonPath) {
			log.error('clearSubtasksDirect called without tasksJsonPath');
			return {
				success: false,
				error: {
					code: 'MISSING_ARGUMENT',
					message: 'tasksJsonPath is required'
				}
			};
		}

		// Either id or all must be provided
		if (!id && !all) {
			return {
				success: false,
				error: {
					code: 'INPUT_VALIDATION_ERROR',
					message:
						'Either task IDs with id parameter or all parameter must be provided'
				}
			};
		}

		// Use provided path
		const tasksPath = tasksJsonPath;

		// Check if tasks.json exists
		if (!fs.existsSync(tasksPath)) {
			return {
				success: false,
				error: {
					code: 'FILE_NOT_FOUND_ERROR',
					message: `Tasks file not found at ${tasksPath}`
				}
			};
		}

		let taskIds;

		// If all is specified, get all task IDs
		if (all) {
			log.info('Clearing subtasks from all tasks');
			const data = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
			if (!data || !data.tasks || data.tasks.length === 0) {
				return {
					success: false,
					error: {
						code: 'INPUT_VALIDATION_ERROR',
						message: 'No valid tasks found in the tasks file'
					}
				};
			}
			taskIds = data.tasks.map((t) => t.id).join(',');
		} else {
			// Use the provided task IDs
			taskIds = id;
		}

		log.info(`Clearing subtasks from tasks: ${taskIds}`);

		// Enable silent mode to prevent console logs from interfering with JSON response
		enableSilentMode();

		// Call the core function
		clearSubtasks(tasksPath, taskIds);

		// Restore normal logging
		disableSilentMode();

		// Read the updated data to provide a summary
		const updatedData = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
		const taskIdArray = taskIds.split(',').map((id) => parseInt(id.trim(), 10));

		// Build a summary of what was done
		const clearedTasksCount = taskIdArray.length;
		const taskSummary = taskIdArray.map((id) => {
			const task = updatedData.tasks.find((t) => t.id === id);
			return task ? { id, title: task.title } : { id, title: 'Task not found' };
		});

		return {
			success: true,
			data: {
				message: `Successfully cleared subtasks from ${clearedTasksCount} task(s)`,
				tasksCleared: taskSummary
			}
		};
	} catch (error) {
		// Make sure to restore normal logging even if there's an error
		disableSilentMode();

		log.error(`Error in clearSubtasksDirect: ${error.message}`);
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
 * Clear subtasks from Jira parent issues
 * @param {Object} args - Function arguments
 * @param {string} [args.parentKey] - Jira parent issue key to clear subtasks from
 * @param {boolean} [args.all] - Clear subtasks from all parent issues in the current project
 * @param {Object} log - Logger object
 * @param {Object} [context] - Execution context
 * @param {Object} [context.session] - Session information for API access
 * @returns {Promise<{success: boolean, data?: Object, error?: {code: string, message: string}}>}
 */
export async function clearJiraSubtasksDirect(args, log, context = {}) {
	// Destructure expected args
	const { parentKey, all } = args;
	try {
		log.info(`Clearing Jira subtasks with args: ${JSON.stringify(args)}`);

		// Either parentKey or all must be provided
		if (!parentKey && !all) {
			return {
				success: false,
				error: {
					code: 'INPUT_VALIDATION_ERROR',
					message: 'Either parentKey or all parameter must be provided'
				}
			};
		}

		// Check if Jira is enabled using the JiraClient
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

		// Enable silent mode to prevent console logs from interfering with JSON response
		enableSilentMode();

		try {
			// Build JQL query based on whether parentKey is provided or all is true
			let jql;
			let parentIssues = [];

			if (all) {
				// If all is specified, get all parent issues in the project
				jql = `project = "${jiraClient.config.project}" AND issuetype != "Subtask" ORDER BY created ASC`;
				log.info(`Fetching all Jira parent issues with JQL: ${jql}`);
			} else {
				// If parentKey is provided, get that specific parent issue
				jql = `project = "${jiraClient.config.project}" AND issuekey = "${parentKey}" ORDER BY created ASC`;
				log.info(`Fetching Jira parent issue ${parentKey} with JQL: ${jql}`);
			}

			// Fetch parent issues
			const searchResult = await jiraClient.searchIssues(jql, {
				maxResults: 100,
				expand: true,
				log
			});

			if (!searchResult.success) {
				disableSilentMode();
				return searchResult; // Return the error response
			}

			parentIssues = searchResult.data;

			if (parentIssues.length === 0) {
				disableSilentMode();
				return {
					success: false,
					error: {
						code: 'PARENT_ISSUES_NOT_FOUND',
						message: `No parent issues found${parentKey ? ` for key ${parentKey}` : ' in the project'}`
					}
				};
			}

			// For each parent issue, find its subtasks and remove them
			const results = [];
			const failedResults = [];
			let totalSubtasksRemoved = 0;

			for (const parentIssue of parentIssues) {
				// Get subtasks for this parent
				const subtasksJql = `project = "${jiraClient.config.project}" AND parent = "${parentIssue.jiraKey}" AND issuetype = "Subtask" ORDER BY created ASC`;
				log.info(
					`Fetching subtasks for parent ${parentIssue.jiraKey} with JQL: ${subtasksJql}`
				);

				const subtasksResult = await jiraClient.searchIssues(subtasksJql, {
					maxResults: 100,
					expand: false,
					log
				});

				if (!subtasksResult.success) {
					log.warn(
						`Error fetching subtasks for ${parentIssue.jiraKey}: ${subtasksResult.error?.message}`
					);
					failedResults.push({
						parentKey: parentIssue.jiraKey,
						error: subtasksResult.error
					});
					continue;
				}

				const subtasks = subtasksResult.data;

				if (subtasks.length === 0) {
					log.info(`No subtasks found for parent ${parentIssue.jiraKey}`);
					results.push({
						parentKey: parentIssue.jiraKey,
						title: parentIssue.title,
						subtasksRemoved: 0,
						subtasks: []
					});
					continue;
				}

				// Remove each subtask
				const removedSubtasks = [];
				let subtasksRemovedCount = 0;

				for (const subtask of subtasks) {
					log.info(
						`Removing subtask ${subtask.jiraKey} from parent ${parentIssue.jiraKey}`
					);
					const removeResult = await removeJiraSubtask(
						subtask.jiraKey,
						false,
						log
					);

					if (removeResult.success) {
						removedSubtasks.push({
							key: subtask.jiraKey,
							title: subtask.title,
							status: 'removed'
						});
						subtasksRemovedCount++;
						totalSubtasksRemoved++;
					} else {
						log.warn(
							`Failed to remove subtask ${subtask.jiraKey}: ${removeResult.error?.message}`
						);
						removedSubtasks.push({
							key: subtask.jiraKey,
							title: subtask.title,
							status: 'failed',
							error: removeResult.error
						});
					}
				}

				results.push({
					parentKey: parentIssue.jiraKey,
					title: parentIssue.title,
					subtasksRemoved: subtasksRemovedCount,
					subtasks: removedSubtasks
				});
			}

			// Restore normal logging
			disableSilentMode();

			// Return summary results
			return {
				success: true,
				data: {
					message: `Successfully cleared ${totalSubtasksRemoved} subtasks from ${results.length} Jira parent issue(s)`,
					parentsProcessed: parentIssues.length,
					totalSubtasksRemoved,
					results,
					failedParents: failedResults
				}
			};
		} catch (error) {
			// Handle Jira API errors
			disableSilentMode();

			log.error(`Error clearing Jira subtasks: ${error.message}`);
			return {
				success: false,
				error: {
					code: 'JIRA_API_ERROR',
					message: `Error clearing Jira subtasks: ${error.message}`,
					details: error.response?.data
				}
			};
		}
	} catch (error) {
		// Make sure to restore normal logging even if there's an error
		disableSilentMode();

		log.error(`Error in clearJiraSubtasksDirect: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'CORE_FUNCTION_ERROR',
				message: error.message
			}
		};
	}
}
