/**
 * add-task.js
 * Direct function implementation for adding a new task
 */

import { addTask } from '../../../../scripts/modules/task-manager.js';
import {
	enableSilentMode,
	disableSilentMode
} from '../../../../scripts/modules/utils.js';
import { createLogWrapper } from '../../tools/utils.js';
import { createJiraIssue } from '../utils/jira-utils.js';
import { JiraTicket } from '../utils/jira-ticket.js';

/**
 * Direct function wrapper for adding a new task with error handling.
 *
 * @param {Object} args - Command arguments
 * @param {string} [args.prompt] - Description of the task to add (required if not using manual fields)
 * @param {string} [args.title] - Task title (for manual task creation)
 * @param {string} [args.description] - Task description (for manual task creation)
 * @param {string} [args.details] - Implementation details (for manual task creation)
 * @param {string} [args.testStrategy] - Test strategy (for manual task creation)
 * @param {string} [args.dependencies] - Comma-separated list of task IDs this task depends on
 * @param {string} [args.priority='medium'] - Task priority (high, medium, low)
 * @param {string} [args.tasksJsonPath] - Path to the tasks.json file (resolved by tool)
 * @param {boolean} [args.research=false] - Whether to use research capabilities for task creation
 * @param {string} [args.projectRoot] - Project root path
 * @param {Object} log - Logger object
 * @param {Object} context - Additional context (session)
 * @returns {Promise<Object>} - Result object { success: boolean, data?: any, error?: { code: string, message: string } }
 */
export async function addTaskDirect(args, log, context = {}) {
	// Destructure expected args (including research and projectRoot)
	const {
		tasksJsonPath,
		prompt,
		dependencies,
		priority,
		research,
		projectRoot
	} = args;
	const { session } = context; // Destructure session from context

	// Enable silent mode to prevent console logs from interfering with JSON response
	enableSilentMode();

	// Create logger wrapper using the utility
	const mcpLog = createLogWrapper(log);

	try {
		// Check if tasksJsonPath was provided
		if (!tasksJsonPath) {
			log.error('addTaskDirect called without tasksJsonPath');
			disableSilentMode(); // Disable before returning
			return {
				success: false,
				error: {
					code: 'MISSING_ARGUMENT',
					message: 'tasksJsonPath is required'
				}
			};
		}

		// Use provided path
		const tasksPath = tasksJsonPath;

		// Check if this is manual task creation or AI-driven task creation
		const isManualCreation = args.title && args.description;

		// Check required parameters
		if (!args.prompt && !isManualCreation) {
			log.error(
				'Missing required parameters: either prompt or title+description must be provided'
			);
			disableSilentMode();
			return {
				success: false,
				error: {
					code: 'MISSING_PARAMETER',
					message:
						'Either the prompt parameter or both title and description parameters are required for adding a task'
				}
			};
		}

		// Extract and prepare parameters
		const taskDependencies = Array.isArray(dependencies)
			? dependencies // Already an array if passed directly
			: dependencies // Check if dependencies exist and are a string
				? String(dependencies)
						.split(',')
						.map((id) => parseInt(id.trim(), 10)) // Split, trim, and parse
				: []; // Default to empty array if null/undefined
		const taskPriority = priority || 'medium'; // Default priority

		let manualTaskData = null;
		let newTaskId;

		if (isManualCreation) {
			// Create manual task data object
			manualTaskData = {
				title: args.title,
				description: args.description,
				details: args.details || '',
				testStrategy: args.testStrategy || ''
			};

			log.info(
				`Adding new task manually with title: "${args.title}", dependencies: [${taskDependencies.join(', ')}], priority: ${priority}`
			);

			// Call the addTask function with manual task data
			newTaskId = await addTask(
				tasksPath,
				null, // prompt is null for manual creation
				taskDependencies,
				taskPriority,
				{
					session,
					mcpLog,
					projectRoot
				},
				'json', // outputFormat
				manualTaskData, // Pass the manual task data
				false, // research flag is false for manual creation
				projectRoot // Pass projectRoot
			);
		} else {
			// AI-driven task creation
			log.info(
				`Adding new task with prompt: "${prompt}", dependencies: [${taskDependencies.join(', ')}], priority: ${taskPriority}, research: ${research}`
			);

			// Call the addTask function, passing the research flag
			newTaskId = await addTask(
				tasksPath,
				prompt, // Use the prompt for AI creation
				taskDependencies,
				taskPriority,
				{
					session,
					mcpLog,
					projectRoot
				},
				'json', // outputFormat
				null, // manualTaskData is null for AI creation
				research // Pass the research flag
			);
		}

		// Restore normal logging
		disableSilentMode();

		return {
			success: true,
			data: {
				taskId: newTaskId,
				message: `Successfully added new task #${newTaskId}`
			}
		};
	} catch (error) {
		// Make sure to restore normal logging even if there's an error
		disableSilentMode();

		log.error(`Error in addTaskDirect: ${error.message}`);
		// Add specific error code checks if needed
		return {
			success: false,
			error: {
				code: error.code || 'ADD_TASK_ERROR', // Use error code if available
				message: error.message
			}
		};
	}
}

/**
 * Create a top-level Jira task, optionally linked to an Epic
 * @param {Object} args - Function arguments
 * @param {string} args.title - The title/summary for the new task
 * @param {string} [args.issueType] - The issue type for the task (default: Task, Epic, Story, Bug, Subtask)
 * @param {string} [args.description] - The description for the task
 * @param {string} [args.details] - The implementation details for the task
 * @param {string} [args.testStrategy] - The test strategy for the task
 * @param {string} [args.acceptanceCriteria] - The acceptance criteria for the task
 * @param {string} [args.parentKey] - The Jira key of the Epic/parent to link this task to (e.g., 'PROJ-5')
 * @param {string} [args.priority] - Jira priority name (e.g., "Medium", "High")
 * @param {string} [args.assignee] - Jira account ID or email of the assignee
 * @param {string[]} [args.labels] - List of labels to add
 * @param {Object} log - Logger object
 * @param {Object} [context={}] - Additional context (e.g., session)
 * @returns {Promise<Object>} - Result object with success status and data/error
 */
export async function addJiraTaskDirect(args, log, context = {}) {
	try {
		// Extract parameters from args
		const {
			title,
			issueType,
			description,
			details,
			acceptanceCriteria,
			testStrategy,
			parentKey,
			priority,
			assignee,
			labels
		} = args;

		// Validate required parameters
		if (!title) {
			return {
				success: false,
				error: {
					code: 'MISSING_PARAMETER',
					message: 'Task title/summary is required'
				}
			};
		}

		log.info(`Creating Jira task with title "${title}"`);

		if (parentKey) {
			log.info(`Task will be linked to parent/epic: ${parentKey}`);
		}

		// Use the JiraTicket class to manage the ticket data and ADF conversion
		const jiraTicket = new JiraTicket({
			title: title,
			description: description,
			details: details,
			acceptanceCriteria: acceptanceCriteria,
			testStrategy: testStrategy,
			parentKey: parentKey,
			priority: priority
				? priority.charAt(0).toUpperCase() + priority.slice(1)
				: 'Medium',
			issueType: issueType || 'Task',
			assignee: assignee,
			labels: labels
		});

		// Call the createJiraIssue function with 'Task' as the issue type
		const result = await createJiraIssue(jiraTicket, log);

		// Return the result directly
		return result;
	} catch (error) {
		// Log the error
		log.error(`Error in addJiraTaskDirect: ${error.message}`);

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
