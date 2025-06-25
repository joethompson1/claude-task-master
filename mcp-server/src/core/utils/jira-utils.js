/**
 * jira-utils.js
 * Utility functions for interacting with Jira API
 */
import { generateTextService } from '../../../../scripts/modules/ai-services-unified.js';
import { isSilentMode, log } from '../../../../scripts/modules/utils.js';
import {
	startLoadingIndicator,
	stopLoadingIndicator
} from '../../../../scripts/modules/ui.js';
import { JiraTicket } from './jira-ticket.js';
import { JiraClient } from './jira-client.js';
import { Anthropic } from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { ContextAggregator } from './context-aggregator.js';
import { JiraRelationshipResolver } from './jira-relationship-resolver.js';
import { BitbucketClient } from './bitbucket-client.js';
import { PRTicketMatcher } from './pr-ticket-matcher.js';

/**
 * Fetch a single Jira task details by its key
 * @param {string} taskId - Jira issue key to fetch
 * @param {boolean} [withSubtasks=false] - If true, will fetch subtasks for the parent task
 * @param {Object} log - Logger object
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.includeImages=true] - Whether to fetch and include image attachments
 * @param {boolean} [options.includeContext=false] - Whether to fetch and include related context (PRs, etc.)
 * @param {number} [options.maxRelatedTickets=10] - Maximum number of related tickets for context
 * @returns {Promise<Object>} - Task details in Task Master format with allTasks array and any image attachments as base64
 */
export async function fetchJiraTaskDetails(
	taskId,
	withSubtasks = false,
	log,
	options = {}
) {
	try {
		// Extract options with defaults
		const {
			includeImages = true,
			includeContext = false,
			maxRelatedTickets = 10
		} = options;

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

		log.info(
			`Fetching Jira task details for key: ${taskId}${includeImages === false ? ' (excluding images)' : ''}`
		);

		// Fetch the issue with conditional image fetching
		const issueResult = await jiraClient.fetchIssue(taskId, {
			log,
			expand: true,
			includeImages
		});

		if (!issueResult.success) {
			return issueResult; // Return the error response from the client
		}

		// Now get subtasks if this is a parent issue
		let subtasksData = null;
		const issue = issueResult.data;

		if (withSubtasks) {
			try {
				// Use existing function to fetch subtasks
				subtasksData = await fetchTasksFromJira(taskId, withSubtasks, log);
			} catch (subtaskError) {
				log.warn(
					`Could not fetch subtasks for ${taskId}: ${subtaskError.message}`
				);
				// Continue without subtasks - this is not fatal
				return {
					success: false,
					error: {
						code: 'SUBTASK_FETCH_ERROR',
						message: subtaskError.message
					}
				};
			}
		}

		// Convert from Jira format to Task Master format
		const task = issue.toTaskMasterFormat();

		if (subtasksData && subtasksData.tasks) {
			task.subtasks = subtasksData.tasks;
		}

		// Add context if requested and available
		if (includeContext) {
			try {
				await addContextToTask(
					task,
					taskId,
					maxRelatedTickets,
					withSubtasks,
					log
				);
			} catch (contextError) {
				// Context failure should not break the main functionality
				log.warn(`Failed to add context to task ${taskId}: ${contextError.message}`);
				// Continue without context
			}
		}

		// For the allTasks array, include the task itself and its subtasks
		const allTasks = [task];
		if (subtasksData && subtasksData.tasks) {
			allTasks.push(...subtasksData.tasks);
		}

		// Prepare response data
		const responseData = {
			task: task,
			allTasks: allTasks,
			images: includeImages ? issue.attachmentImages || [] : []
		};

		return {
			success: true,
			data: responseData
		};
	} catch (error) {
		log.error(`Error fetching Jira task details: ${error.message}`);

		// Handle 404 Not Found specifically
		if (error.response && error.response.status === 404) {
			return {
				success: false,
				error: {
					code: 'TASK_NOT_FOUND',
					message: `Jira issue with key ${taskId} not found`
				}
			};
		}

		// Handle other API errors
		return {
			success: false,
			error: {
				code: 'JIRA_API_ERROR',
				message: error.message || 'Error communicating with Jira API'
			}
		};
	}
}

/**
 * Create MCP-compatible content response with images
 * @param {Object} taskData - Task data from fetchJiraTaskDetails
 * @param {string} [textContent] - Optional text content to include
 * @returns {Array} - MCP content array with text and images
 */
export function createMCPContentWithImages(taskData, textContent = null) {
	const content = [];

	// Add text content if provided
	if (textContent) {
		content.push({
			type: 'text',
			text: textContent
		});
	}

	// Add images if available
	if (taskData.images && taskData.images.length > 0) {
		for (const image of taskData.images) {
			content.push({
				type: 'image',
				data: image.data,
				mimeType: image.mimeType
			});
		}
	}

	return content;
}

/**
 * Fetch tasks from Jira for a specific parent issue key
 * @param {string} parentKey - Parent Jira issue key, if null will fetch all tasks in the project
 * @param {boolean} [withSubtasks=false] - If true, will fetch subtasks for the parent task
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} - Tasks and statistics in Task Master format
 */
export async function fetchTasksFromJira(parentKey, withSubtasks = false, log) {
	try {
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

		// Build JQL query based on whether parentKey is provided
		let jql;
		if (parentKey) {
			// If parentKey is provided, get subtasks for the specific parent
			jql = `project = "${jiraClient.config.project}" AND parent = "${parentKey}" ORDER BY created ASC`;
			log.info(
				`Fetching Jira subtasks for parent ${parentKey} with JQL: ${jql}`
			);
		} else {
			// If no parentKey, get all tasks in the project
			jql = `project = "${jiraClient.config.project}" ORDER BY created ASC`;
			log.info(`Fetching all Jira tasks with JQL: ${jql}`);
		}

		// Use the searchIssues method instead of direct HTTP request
		// Now returns JiraTicket objects directly
		const searchResult = await jiraClient.searchIssues(jql, {
			maxResults: 100,
			expand: true,
			log
		});

		if (!searchResult.success) {
			return searchResult; // Return the error response
		}

		const issues = searchResult.data;
		if (issues.length === 0) {
			log.info(`No issues found with the specified ID(s)`);
			return {
				success: false,
				error: {
					code: 'ISSUES_NOT_FOUND',
					message: `No issues found with the specified ID(s)`
				}
			};
		}

		// Convert JiraTicket objects to Task Master format
		const tasks = await Promise.all(
			searchResult.data.map(async (jiraTicket) => {
				// Get task in Task Master format
				const task = jiraTicket.toTaskMasterFormat();

				// Fetch subtasks if withSubtasks is true and the ticket has subtasks
				if (withSubtasks && jiraTicket.jiraKey) {
					log.info(`Fetching subtasks for ${jiraTicket.jiraKey}`);
					try {
						// Recursive call to fetch subtasks using the current issue key as parent
						const subtasksResult = await fetchTasksFromJira(
							jiraTicket.jiraKey,
							false,
							log
						);
						if (subtasksResult && subtasksResult.tasks) {
							task.subtasks = subtasksResult.tasks;
							log.info(
								`Added ${task.subtasks.length} subtasks to ${jiraTicket.jiraKey}`
							);
						}
					} catch (subtaskError) {
						log.warn(
							`Error fetching subtasks for ${jiraTicket.jiraKey}: ${subtaskError.message}`
						);
						// Continue without subtasks - this is not fatal
					}
				}

				return task;
			})
		);

		// Calculate statistics
		const totalTasks = tasks.length;
		const completedTasks = tasks.filter(
			(t) => t.status === 'done' || t.status === 'completed'
		).length;
		const inProgressCount = tasks.filter(
			(t) => t.status === 'in-progress'
		).length;
		const pendingCount = tasks.filter((t) => t.status === 'pending').length;
		const blockedCount = tasks.filter((t) => t.status === 'blocked').length;
		const deferredCount = tasks.filter((t) => t.status === 'deferred').length;
		const cancelledCount = tasks.filter((t) => t.status === 'cancelled').length;
		const completionPercentage =
			totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

		// Calculate subtask statistics
		let subtaskStats = {
			total: 0,
			completed: 0,
			inProgress: 0,
			pending: 0,
			blocked: 0,
			deferred: 0,
			cancelled: 0,
			completionPercentage: 0
		};

		// If withSubtasks is true, collect statistics for all subtasks
		if (withSubtasks) {
			const allSubtasks = tasks.flatMap((task) => task.subtasks || []);
			subtaskStats.total = allSubtasks.length;
			subtaskStats.completed = allSubtasks.filter(
				(t) => t.status === 'done' || t.status === 'completed'
			).length;
			subtaskStats.inProgress = allSubtasks.filter(
				(t) => t.status === 'in-progress'
			).length;
			subtaskStats.pending = allSubtasks.filter(
				(t) => t.status === 'pending'
			).length;
			subtaskStats.blocked = allSubtasks.filter(
				(t) => t.status === 'blocked'
			).length;
			subtaskStats.deferred = allSubtasks.filter(
				(t) => t.status === 'deferred'
			).length;
			subtaskStats.cancelled = allSubtasks.filter(
				(t) => t.status === 'cancelled'
			).length;
			subtaskStats.completionPercentage =
				subtaskStats.total > 0
					? (subtaskStats.completed / subtaskStats.total) * 100
					: 0;
		}

		// Return in the same format as listTasks
		return {
			success: true,
			tasks,
			filter: 'all',
			stats: {
				total: totalTasks,
				completed: completedTasks,
				inProgress: inProgressCount,
				pending: pendingCount,
				blocked: blockedCount,
				deferred: deferredCount,
				cancelled: cancelledCount,
				completionPercentage,
				subtasks: subtaskStats
			},
			source: 'jira',
			parentKey: parentKey || 'all'
		};
	} catch (error) {
		log.error(`Error fetching tasks from Jira: ${error.message}`);
		throw error;
	}
}

/**
 * Create a Jira issue (task or subtask)
 * @param {JiraTicket} jiraTicket - The jira ticket object to create
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} - Result object with success status and data/error
 */
export async function createJiraIssue(jiraTicket, log) {
	try {
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

		// Validate required parameters
		if (!jiraTicket.issueType) {
			return {
				success: false,
				error: {
					code: 'MISSING_PARAMETER',
					message: 'Issue type is required'
				}
			};
		}

		if (!jiraTicket.title) {
			return {
				success: false,
				error: {
					code: 'MISSING_PARAMETER',
					message: 'Summary/title is required'
				}
			};
		}

		// For subtasks, parentKey is required
		if (jiraTicket.issueType === 'Subtask' && !jiraTicket.parentKey) {
			return {
				success: false,
				error: {
					code: 'MISSING_PARAMETER',
					message: 'Parent issue key is required for Subtask creation'
				}
			};
		}

		if (jiraTicket.issueType === 'Subtask') {
			log.info(`Creating Jira subtask under parent ${jiraTicket.parentKey}`);
		} else {
			log.info(`Creating Jira ${jiraTicket.issueType.toLowerCase()}`);
			if (jiraTicket.parentKey) {
				log.info(`... linked to parent/epic ${jiraTicket.parentKey}`);
			}
		}

		try {
			// Make the API request
			const client = jiraClient.getClient();
			const response = await client.post(
				'/rest/api/3/issue',
				jiraTicket.toJiraRequestData()
			);

			// Return success with data
			return {
				success: true,
				data: {
					key: response.data.key,
					id: response.data.id,
					self: response.data.self
				}
			};
		} catch (requestError) {
			// Check if the error is related to the priority field
			const isPriorityError =
				requestError.response?.data?.errors?.priority ===
				"Field 'priority' cannot be set. It is not on the appropriate screen, or unknown.";

			// If it's a priority field error and we included priority, retry without it
			if (isPriorityError && jiraTicket.priority) {
				log.warn(
					`Priority field error detected: ${requestError.response.data.errors.priority}`
				);
				log.info('Retrying issue creation without priority field...');

				// Remove priority from the request
				if (requestBody.fields.priority) {
					delete requestBody.fields.priority;
				}

				try {
					// Retry the API request without priority
					const client = jiraClient.getClient();
					const retryResponse = await client.post(
						'/rest/api/3/issue',
						requestBody
					);
				} catch (retryError) {
					log.error(`Error creating Jira issue: ${retryError.message}`);
					throw retryError;
				}

				// Return success with data from retry
				return {
					success: true,
					data: {
						key: retryResponse.data.key,
						id: retryResponse.data.id,
						self: retryResponse.data.self,
						note: 'Created without priority field due to screen configuration'
					}
				};
			}

			// If it's not a priority error or retry fails, throw the error to be caught by outer catch
			throw requestError;
		}
	} catch (error) {
		// Log the error
		const issueTypeDisplay =
			jiraTicket.issueType === 'Subtask'
				? 'subtask'
				: jiraTicket.issueType.toLowerCase();
		log.error(`Error creating Jira ${issueTypeDisplay}: ${error.message}`);

		// Debug: Log the full error object to see what's available
		const errorDetails = {
			message: error.message,
			name: error.name,
			status: error.response?.status,
			statusText: error.response?.statusText,
			data: error.response?.data || {},
			errorMessages: error.response?.data?.errorMessages || [],
			errors: error.response?.data?.errors || {},
			headers: error.response?.headers
				? Object.keys(error.response.headers)
				: [],
			config: error.config
				? {
						url: error.config.url,
						method: error.config.method,
						baseURL: error.config.baseURL,
						headers: Object.keys(error.config.headers || {})
					}
				: {},
			isAxiosError: error.isAxiosError || false,
			code: error.code || 'NO_CODE'
		};

		// Create a more descriptive error message
		const errorMessage = [
			error.response?.status
				? `${error.response.status} ${error.response.statusText || ''}`
				: '',
			error.response?.data?.errorMessages
				? error.response.data.errorMessages.join(', ')
				: error.message,
			error.response?.data?.errors
				? JSON.stringify(error.response.data.errors)
				: '',
			error.code ? `(Error code: ${error.code})` : ''
		]
			.filter(Boolean)
			.join(' - ');

		// Return structured error response
		return {
			success: false,
			error: {
				code: error.response?.status || error.code || 'JIRA_API_ERROR',
				message:
					error.response?.data?.errorMessages?.join(', ') || error.message,
				details: errorDetails,
				displayMessage: errorMessage
			}
		};
	}
}

/**
 * Set the status of a Jira task
 * @param {string} taskId - Jira issue key to update (e.g., "PROJ-123")
 * @param {string} newStatus - New status to set
 * @param {Object} options - Additional options (mcpLog for MCP mode)
 * @returns {Promise<Object>} Result object with success status and data/error
 */
export async function setJiraTaskStatus(taskId, newStatus, options = {}) {
	try {
		// Get logger from options or use silent logger for MCP compatibility
		const log = options.mcpLog || {
			info: () => {},
			warn: () => {},
			error: () => {}
		};

		// Determine if we're in MCP mode by checking for mcpLog
		const isMcpMode = !!options?.mcpLog;

		// Only display UI elements if not in MCP mode
		if (!isMcpMode) {
			// Skip UI elements that would break JSON output
			log.info(`Updating Jira task ${taskId} status to: ${newStatus}`);
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

		// Handle multiple task IDs (comma-separated)
		const taskIds = taskId.split(',').map((id) => id.trim());
		const updatedTasks = [];

		// Update each task
		for (const id of taskIds) {
			log.info(`Updating status for Jira issue ${id} to "${newStatus}"...`);

			try {
				// Use the JiraClient's transitionIssue method
				const transitionResult = await jiraClient.transitionIssue(
					id,
					newStatus,
					{ log }
				);

				if (!transitionResult.success) {
					throw new Error(
						transitionResult.error?.message || 'Transition failed'
					);
				}

				log.info(
					`Successfully updated Jira issue ${id} status to "${newStatus}"`
				);
				updatedTasks.push(id);
			} catch (error) {
				log.error(`Error updating status for issue ${id}: ${error.message}`);
				throw new Error(`Failed to update Jira issue ${id}: ${error.message}`);
			}
		}

		// Return success value for programmatic use
		return {
			success: true,
			data: {
				updatedTasks: updatedTasks.map((id) => ({
					id,
					status: newStatus
				}))
			}
		};
	} catch (error) {
		// Log the error
		const errorMessage = `Error setting Jira task status: ${error.message}`;

		if (options.mcpLog) {
			options.mcpLog.error(errorMessage);
		}
		// Don't use console.error in MCP mode as it breaks the JSON protocol

		// In MCP mode, return error object
		return {
			success: false,
			error: {
				code: 'JIRA_STATUS_UPDATE_ERROR',
				message: error.message
			}
		};
	}
}

/**
 * Find the next pending task based on dependencies from Jira
 * @param {string} [parentKey] - Optional parent/epic key to filter tasks
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} The next task to work on and all retrieved tasks
 */
export async function findNextJiraTask(parentKey, log) {
	try {
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

		// Array to store all tasks retrieved from Jira
		let allTasks = [];

		if (parentKey) {
			log.info(`Finding next task for parent/epic: ${parentKey}`);
		} else {
			log.info('No parent key provided, fetching all pending tasks');
		}

		// Get tasks using fetchTasksFromJira - whether filtering by parent or getting all tasks
		const result = await fetchTasksFromJira(parentKey, true, log);
		if (result && result.tasks) {
			allTasks = result.tasks;
			log.info(
				`Found ${allTasks.length} tasks ${parentKey ? `for parent ${parentKey}` : 'in total'}`
			);
		}

		if (allTasks.length === 0) {
			log.info('No tasks found');
			return {
				success: true,
				data: {
					nextTask: null
				}
			};
		}

		// Get all completed task IDs
		const completedTaskIds = new Set(
			allTasks
				.filter((t) => t.status === 'done' || t.status === 'completed')
				.map((t) => t.id)
		);

		// Filter for pending tasks whose dependencies are all satisfied
		const eligibleTasks = allTasks.filter(
			(task) =>
				task.status === 'pending' && // Only tasks with pending status
				(!task.dependencies || // No dependencies, or
					task.dependencies.length === 0 || // Empty dependencies array, or
					task.dependencies.every((depId) => completedTaskIds.has(depId))) // All dependencies completed
		);

		if (eligibleTasks.length === 0) {
			log.info(
				'No eligible tasks found - all tasks are either completed or have unsatisfied dependencies'
			);
			return {
				success: true,
				data: {
					nextTask: null
				}
			};
		}

		// Sort eligible tasks by:
		// 1. Priority (high > medium > low)
		// 2. Dependencies count (fewer dependencies first)
		// 3. ID (lower ID first)
		const priorityValues = { high: 3, medium: 2, low: 1 };

		const nextTask = eligibleTasks.sort((a, b) => {
			// Sort by priority first
			const priorityA = priorityValues[a.priority || 'medium'] || 2;
			const priorityB = priorityValues[b.priority || 'medium'] || 2;

			if (priorityB !== priorityA) {
				return priorityB - priorityA; // Higher priority first
			}

			// If priority is the same, sort by dependency count
			const depCountA = a.dependencies ? a.dependencies.length : 0;
			const depCountB = b.dependencies ? b.dependencies.length : 0;
			if (depCountA !== depCountB) {
				return depCountA - depCountB; // Fewer dependencies first
			}

			// If dependency count is the same, sort by ID (using string comparison since Jira IDs are like "PROJ-123")
			return a.id.localeCompare(b.id, undefined, { numeric: true });
		})[0]; // Return the first (highest priority) task

		// Get full details for the next task
		const nextTaskDetails = await fetchJiraTaskDetails(nextTask.id, true, log);

		// Log the found next task
		log.info(
			`Found next task: ${nextTask.id} - ${nextTask.title} (${nextTask.priority} priority)`
		);

		return {
			success: true,
			data: {
				nextTask: nextTaskDetails.success ? nextTaskDetails.data.task : nextTask
			}
		};
	} catch (error) {
		log.error(`Error finding next Jira task: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'JIRA_API_ERROR',
				message: error.message
			}
		};
	}
}

/**
 * Updates one or more Jira issues (tasks or subtasks) with new information based on a prompt.
 * @param {string|Array<string>} issueIds - Single Jira issue ID or array of IDs to update (in format "PROJ-123")
 * @param {string} prompt - New information or context to incorporate into the issue(s)
 * @param {boolean} useResearch - Whether to use Perplexity AI for research-backed updates
 * @param {Object} options - Additional options including session and logging
 * @returns {Promise} - Result object with success status and updated issue details
 */
export async function updateJiraIssues(
	issueIds,
	prompt,
	useResearch = false,
	options = {}
) {
	const { session, projectRoot } = options;

	// Get logger from options or use silent logger for MCP compatibility
	const log = options.mcpLog || {
		info: () => {},
		warn: () => {},
		error: () => {}
	};

	try {
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

		// Handle both single ID (string) and multiple IDs (array)
		const isMultipleIssues = Array.isArray(issueIds);
		const issueIdArray = isMultipleIssues ? issueIds : [issueIds];

		// Validate input
		if (!issueIdArray.length) {
			throw new Error(
				'Missing required parameter: issueIds must be a non-empty string or array'
			);
		}

		if (!prompt) {
			throw new Error('Missing required parameter: prompt');
		}

		// Validate all issue IDs have the correct format (PROJ-123)
		issueIdArray.forEach((id) => {
			if (!(typeof id === 'string' && id.includes('-'))) {
				throw new Error(`Issue ID "${id}" must be in the format "PROJ-123"`);
			}
		});

		log.info(`Updating ${issueIdArray.length} Jira issue(s) based on prompt`);

		// Build JQL query to get the specific issues by ID
		const formattedIds = issueIdArray.map((id) => `"${id}"`).join(',');
		const jql = `issuekey IN (${formattedIds}) ORDER BY issuekey ASC`;

		log.info(`Fetching Jira issues with JQL: ${jql}`);

		// Use jiraClient.searchIssues instead of direct client.get
		const searchResult = await jiraClient.searchIssues(jql, {
			maxResults: 100,
			expand: true,
			log
		});

		if (!searchResult.success) {
			return searchResult;
		}

		const issues = searchResult.data;
		if (issues.length === 0) {
			log.info(`No issues found with the specified ID(s)`);
			return {
				success: false,
				error: {
					code: 'ISSUES_NOT_FOUND',
					message: `No issues found with the specified ID(s)`
				}
			};
		}

		// Convert Jira issues to a format suitable for the AI
		const tasks = issues.map((jiraTicket) => jiraTicket.toTaskMasterFormat());

		// Track which issues are subtasks
		const issueTypeMap = issues.reduce((map, jiraTicket) => {
			map[jiraTicket.jiraKey] = {
				isSubtask: jiraTicket.issueType === 'Subtask',
				parentKey: jiraTicket.parentKey
			};
			return map;
		}, {});

		log.info(
			`Found ${tasks.length} issue(s) to update (${Object.values(issueTypeMap).filter((i) => i.isSubtask).length} subtasks)`
		);

		const systemPrompt = `You are an AI assistant helping to update software development tasks based on new context.
You will be given a set of tasks and a prompt describing changes or new implementation details.
Your job is to update the tasks to reflect these changes, while preserving their basic structure.

Guidelines:
1. Maintain the same IDs, statuses, and dependencies unless specifically mentioned in the prompt
2. Update titles, descriptions, details, and test strategies to reflect the new information
3. Do not change anything unnecessarily - just adapt what needs to change based on the prompt
4. You should return ALL the tasks in order, not just the modified ones
5. Return a complete valid JSON object with the updated tasks array
6. VERY IMPORTANT: Preserve all subtasks marked as "done" or "completed" - do not modify their content
7. For tasks with completed subtasks, build upon what has already been done rather than rewriting everything
8. If an existing completed subtask needs to be changed/undone based on the new context, DO NOT modify it directly
9. Instead, add a new subtask that clearly indicates what needs to be changed or replaced
10. Use the existence of completed subtasks as an opportunity to make new subtasks more specific and targeted

The changes described in the prompt should be applied to ALL tasks in the list. Do not wrap your response in \`\`\`json\`\`\``;

		const role = useResearch ? 'research' : 'main';
		const userPrompt = `Here are the tasks to update:\n${JSON.stringify(tasks)}\n\nPlease update these tasks based on the following new context:\n${prompt}\n\nIMPORTANT: In the tasks JSON above, any subtasks with "status": "done" or "status": "completed" should be preserved exactly as is. Build your changes around these completed items.\n\nReturn only the updated tasks as a valid JSON array.`;

		let updates = await generateTextService({
			prompt: userPrompt,
			systemPrompt: systemPrompt,
			role,
			session,
			projectRoot
		});

		// Check if updates is a string and try to parse it as JSON
		if (typeof updates === 'string') {
			try {
				updates = JSON.parse(updates);
				log.info('Successfully parsed string response into JSON');
			} catch (parseError) {
				log.error(
					`Failed to parse updates string as JSON: ${parseError.message}`
				);
				throw new Error('Failed to parse LLM response into valid JSON');
			}
		}

		if (!updates || !Array.isArray(updates)) {
			throw new Error('Failed to generate valid updates, updates: ' + updates);
		}

		log.info(`Successfully parsed updates for ${updates.length} issue(s)`);

		// Apply the updates to Jira
		const updateResults = [];
		for (let i = 0; i < updates.length; i++) {
			const update = updates[i];
			if (!update.id) {
				log.warn('Update is missing id identifier, skipping');
				continue;
			}

			try {
				log.info(`Updating Jira issue: ${update.id}`);

				const issueInfo = issueTypeMap[update.id];
				const isSubtask = issueInfo?.isSubtask || false;

				// For subtasks, we need to preserve the parent relationship
				if (isSubtask) {
					// Get the complete issue data to ensure we preserve parent relation
					const fullIssueResponse = await jiraClient.fetchIssue(update.id, {
						log
					});
					if (!fullIssueResponse.success) {
						log.warn(
							`Failed to fetch full issue details: ${fullIssueResponse.error?.message}`
						);
						continue;
					}
					const fullIssue = fullIssueResponse.data;
					const parentKey = fullIssue.parentKey || issueInfo.parentKey;

					if (!parentKey) {
						log.warn(`Subtask ${update.id} is missing parent relationship`);
					}
				}

				// Create a JiraTicket with properties from the update
				const jiraTicket = new JiraTicket({
					title: update.title,
					description: update.description,
					// Include all relevant fields from the update
					details: update.implementationDetails || update.details,
					acceptanceCriteria: update.acceptanceCriteria,
					testStrategy: update.testStrategyTdd || update.testStrategy,
					// Include other properties
					priority: update.priority,
					jiraKey: update.id
				});

				// For subtasks, preserve the issue type
				if (isSubtask) {
					jiraTicket.issueType = 'Subtask';
					jiraTicket.parentKey = issueInfo.parentKey;
				}

				// Convert to proper Jira request format
				const requestData = jiraTicket.toJiraRequestData();

				// Apply the updates if there are any fields to update
				if (Object.keys(requestData.fields).length > 0) {
					try {
						// We don't want to change certain fields in the update
						delete requestData.fields.issuetype;
						delete requestData.fields.project;

						// For subtasks, don't change the parent relationship
						if (isSubtask) {
							delete requestData.fields.parent;
						}

						// Only apply the update if we have fields to update
						if (Object.keys(requestData.fields).length > 0) {
							const client = jiraClient.getClient();
							await client.put(`/rest/api/3/issue/${update.id}`, {
								fields: requestData.fields
							});

							log.info(
								`Updated issue ${update.id} fields: ${Object.keys(requestData.fields).join(', ')}`
							);
						} else {
							log.info(`No fields to update for issue ${update.id}`);
						}
					} catch (updateError) {
						// Log detailed error information
						log.error(`Error updating issue: ${updateError.message}`);

						if (updateError.response && updateError.response.data) {
							log.error(
								`API error details: ${JSON.stringify(updateError.response.data)}`
							);

							// If there are specific field errors, log them and try again without those fields
							if (updateError.response.data.errors) {
								Object.entries(updateError.response.data.errors).forEach(
									([field, error]) => {
										log.error(`Field error - ${field}: ${error}`);

										// Remove problematic fields
										delete requestData.fields[field];
									}
								);

								// Retry with remaining fields if any
								if (Object.keys(requestData.fields).length > 0) {
									log.info(`Retrying update without problematic fields...`);
									const client = jiraClient.getClient();
									await client.put(`/rest/api/3/issue/${update.id}`, {
										fields: requestData.fields
									});
									log.info(
										`Updated issue ${update.id} with remaining fields: ${Object.keys(requestData.fields).join(', ')}`
									);
								}
							}
						}
					}
				}

				// Find the original task that matches this update
				const originalTask = tasks.find(
					(task) => task.id === update.id || task.jiraKey === update.id
				);

				if (!originalTask) {
					log.error(`Issue ${update.id} not found in tasks array`);
					continue;
				}

				// Record changes applied
				const changesApplied = [];
				if (originalTask.title !== update.title)
					changesApplied.push({
						field: 'summary',
						old: originalTask.title,
						new: update.title
					});
				if (originalTask.description !== update.description)
					changesApplied.push({
						field: 'description',
						old: originalTask.description,
						new: update.description
					});
				if (originalTask.priority !== update.priority)
					changesApplied.push({
						field: 'priority',
						old: originalTask.priority,
						new: update.priority
					});
				if (originalTask.implementationDetails !== update.implementationDetails)
					changesApplied.push({
						field: 'implementationDetails',
						old: originalTask.implementationDetails,
						new: update.implementationDetails
					});
				if (originalTask.acceptanceCriteria !== update.acceptanceCriteria)
					changesApplied.push({
						field: 'acceptanceCriteria',
						old: originalTask.acceptanceCriteria,
						new: update.acceptanceCriteria
					});
				if (originalTask.testStrategyTdd !== update.testStrategyTdd)
					changesApplied.push({
						field: 'testStrategy',
						old: originalTask.testStrategyTdd,
						new: update.testStrategyTdd
					});

				// Record updates that were applied
				updateResults.push({
					key: update.id,
					success: true,
					isSubtask: isSubtask,
					changeType: changesApplied.map((change) => change.field),
					changeDetails: changesApplied
				});
			} catch (error) {
				log.error(`Failed to update issue ${update.id}: ${error.message}`);
				updateResults.push({
					key: update.id || 'unknown',
					success: false,
					error: error.message
				});
			}
		}

		// Return different result formats based on whether it was a single or multiple update
		if (!isMultipleIssues) {
			// Single issue update result format (similar to original updateJiraIssueById)
			const result = updateResults[0] || {
				success: false,
				error: { code: 'UPDATE_FAILED', message: 'Failed to update issue' }
			};

			if (result.success) {
				return {
					success: true,
					data: {
						message: `Successfully updated Jira ${result.isSubtask ? 'subtask' : 'issue'} ${result.key} based on the prompt`,
						issueId: result.key,
						isSubtask: result.isSubtask,
						changeType: result.changeType,
						changeDetails: result.changeDetails
					}
				};
			} else {
				return {
					success: false,
					error: {
						code: 'UPDATE_JIRA_ISSUE_ERROR',
						message: result.error
					}
				};
			}
		} else {
			// Multiple issues update result format (similar to original updateJiraTasks)
			const successCount = updateResults.filter((r) => r.success).length;
			return {
				success: successCount > 0,
				message: `Updated ${successCount} out of ${updateResults.length} issues based on the prompt`,
				results: updateResults
			};
		}
	} catch (error) {
		log.error(`Failed to update Jira issue(s): ${error.message}`);
		return {
			success: false,
			error: {
				code: 'UPDATE_JIRA_ISSUES_ERROR',
				message: error.message
			}
		};
	}
}

/**
 * Expands a Jira task into multiple subtasks using AI
 * @param {string} taskId - The Jira issue key to expand
 * @param {number} [numSubtasks] - Number of subtasks to generate (default based on env var)
 * @param {boolean} [useResearch=false] - Enable Perplexity AI for research-backed subtask generation
 * @param {string} [additionalContext=''] - Additional context to guide subtask generation
 * @param {Object} options - Options object containing session and logging info
 * @param {Object} [options.mcpLog] - Logger object for MCP mode
 * @param {Object} [options.session] - Session object for AI clients
 * @param {boolean} [options.force=false] - Force regeneration of subtasks
 * @returns {Promise<{success: boolean, data: Object, error: Object}>} Result of the expansion
 */
export async function expandJiraTask(
	taskId,
	numSubtasks,
	useResearch = false,
	additionalContext = '',
	options = {}
) {
	// Destructure options object
	const { reportProgress, mcpLog, session, force = false } = options;

	// Determine output format based on mcpLog presence (simplification)
	const outputFormat = mcpLog ? 'json' : 'text';

	// Create custom reporter that checks for MCP log and silent mode
	const report = (message, level = 'info') => {
		if (mcpLog) {
			mcpLog[level](message);
		} else if (!isSilentMode() && outputFormat === 'text') {
			// Only log to console if not in silent mode and outputFormat is 'text'
			log(level, message);
		}
	};

	// Keep the mcpLog check for specific MCP context logging
	if (mcpLog) {
		mcpLog.info(
			`expandTask - reportProgress available: ${!!reportProgress}, session available: ${!!session}`
		);
	}

	try {
		report(`Expanding task ${taskId}`);

		// Get task details
		const taskDetails = await fetchJiraTaskDetails(taskId, true, mcpLog);
		if (!taskDetails.success) {
			throw new Error(
				`Failed to fetch Jira task: ${taskDetails.error?.message || 'Unknown error'}`
			);
		}

		const task = taskDetails.data.task;

		// Check if the task already has subtasks and force isn't enabled
		const hasExistingSubtasks = task.subtasks && task.subtasks.length > 0;
		if (hasExistingSubtasks && !force) {
			report(`Task ${taskId} already has ${task.subtasks.length} subtasks`);
			return {
				success: true,
				message: `Task ${taskId} already has subtasks. Expansion skipped.`,
				task,
				subtasksCount: task.subtasks.length,
				subtasks: task.subtasks
			};
		}

		// Calculate the number of subtasks to generate
		const defaultSubtasksCount = parseInt(
			process.env.DEFAULT_SUBTASKS || '3',
			10
		);
		const subtasksToGenerate = numSubtasks
			? parseInt(numSubtasks, 10)
			: defaultSubtasksCount;

		// Create a JiraTicket instance from the task data
		const jiraTicket = JiraTicket.fromTaskMaster(task);

		// Create a proper wrapper for mcpLog
		const logWrapper = {
			info: (message) => report(message),
			warn: (message) => report(message),
			error: (message) => report(message),
			debug: (message) => report(message),
			success: (message) => report(message) // Map success to info
		};

		report(`Generating ${subtasksToGenerate} subtasks for Jira task ${taskId}`);

		// Generate subtasks with the AI service
		const generatedSubtasks = await generateSubtasks(
			jiraTicket.toTaskMasterFormat(),
			subtasksToGenerate,
			useResearch,
			additionalContext,
			{
				reportProgress,
				mcpLog: logWrapper,
				session,
				silentMode: isSilentMode()
			}
		);

		if (!generatedSubtasks || !Array.isArray(generatedSubtasks)) {
			throw new Error('Failed to generate subtasks with AI');
		}

		report(
			`Successfully generated ${generatedSubtasks.length} subtasks. Creating in Jira...`
		);

		// Create each subtask in Jira
		const createdSubtasks = [];
		const issueKeyMap = new Map(); // Map subtask ID to Jira issue key for dependency linking

		for (let i = 0; i < generatedSubtasks.length; i++) {
			const subtask = generatedSubtasks[i];

			try {
				// Create a JiraTicket instance for the subtask
				const jiraTicket = new JiraTicket({
					title: subtask.title,
					description: subtask.description || '',
					details: subtask.details || '',
					acceptanceCriteria: subtask.acceptanceCriteria || '',
					testStrategy: subtask.testStrategy || '',
					priority: subtask.priority || task.priority,
					issueType: 'Subtask',
					parentKey: taskId
				});

				// Create the subtask in Jira
				report(
					`Creating subtask ${i + 1}/${generatedSubtasks.length}: ${subtask.title}`
				);
				const createResult = await createJiraIssue(jiraTicket, mcpLog);

				if (createResult.success) {
					const jiraKey = createResult.data.key;
					createdSubtasks.push({
						...subtask,
						id: jiraKey,
						jiraKey: jiraKey
					});
					// Store the mapping from subtask.id to Jira issue key for dependency linking
					issueKeyMap.set(subtask.id, jiraKey);
					report(`Successfully created subtask: ${jiraKey}`);
				} else {
					report(
						`Failed to create subtask: ${createResult.error?.message || 'Unknown error'}`
					);
				}
			} catch (error) {
				report(`Error creating subtask: ${error.message}`);
				// Continue with the next subtask even if this one fails
			}
		}

		// Add dependency links between subtasks
		report(`Setting up dependencies between subtasks...`);
		const jiraClient = new JiraClient();
		const client = jiraClient.getClient();
		const dependencyLinks = [];

		// Process each subtask with dependencies
		for (const subtask of generatedSubtasks) {
			if (
				subtask.dependencies &&
				Array.isArray(subtask.dependencies) &&
				subtask.dependencies.length > 0
			) {
				const dependentIssueKey = issueKeyMap.get(subtask.id);

				if (dependentIssueKey) {
					for (const dependencyId of subtask.dependencies) {
						// Skip dependency on "0" which is often used as a placeholder
						if (dependencyId === 0) continue;

						const dependencyKey = issueKeyMap.get(dependencyId);

						if (dependencyKey) {
							report(
								`Linking issue ${dependentIssueKey} to depend on ${dependencyKey}`
							);

							try {
								// Create issue link using Jira REST API
								// "Blocks" link type means the dependency blocks the dependent issue
								const linkPayload = {
									type: {
										name: 'Blocks' // Common link type - this issue blocks the dependent issue
									},
									inwardIssue: {
										key: dependencyKey
									},
									outwardIssue: {
										key: dependentIssueKey
									}
								};

								await client.post('/rest/api/3/issueLink', linkPayload);

								dependencyLinks.push({
									from: dependentIssueKey,
									to: dependencyKey
								});

								report(
									`Created dependency link from ${dependentIssueKey} to ${dependencyKey}`
								);
							} catch (error) {
								report(
									`Error creating dependency link from ${dependentIssueKey} to ${dependencyKey}: ${error.message}`,
									'error'
								);
							}
						} else {
							report(
								`Dependency subtask ID ${dependencyId} not found in created issues`,
								'warn'
							);
						}
					}
				}
			}
		}

		// Return the results
		return {
			success: true,
			data: {
				message: `Created ${createdSubtasks.length} subtasks for Jira task ${taskId} with ${dependencyLinks.length} dependency links`,
				taskId,
				subtasksCount: createdSubtasks.length,
				subtasks: createdSubtasks,
				dependencyLinks
			}
		};
	} catch (error) {
		report(`Error in expandJiraTask: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'EXPAND_JIRA_TASK_ERROR',
				message: error.message
			}
		};
	}
}

/**
 * Removes a Jira subtask
 * @param {string} subtaskId - Jira subtask issue key to remove (e.g., "PROJ-123")
 * @param {boolean} [convert=false] - Whether to convert the subtask to a standalone task instead of deleting
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} - Result with success status and data/error
 */
export async function removeJiraSubtask(subtaskId, convert = false, log) {
	try {
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

		log.info(`Removing Jira subtask ${subtaskId} (convert: ${convert})`);

		// First, fetch the subtask to verify it exists and is actually a subtask
		const subtaskResult = await jiraClient.fetchIssue(subtaskId, { log });

		if (!subtaskResult.success) {
			return {
				success: false,
				error: {
					code: 'SUBTASK_NOT_FOUND',
					message: `Could not find subtask with key ${subtaskId}: ${subtaskResult.error?.message || 'Unknown error'}`
				}
			};
		}

		const subtask = subtaskResult.data;

		// Verify it's a subtask
		if (subtask.issueType !== 'Subtask') {
			return {
				success: false,
				error: {
					code: 'NOT_A_SUBTASK',
					message: `Issue ${subtaskId} is not a subtask (type: ${subtask.issueType})`
				}
			};
		}

		// Get the parent key
		const parentKey = subtask.parentKey;
		if (!parentKey) {
			log.warn(`Subtask ${subtaskId} does not have a parent reference`);
		}

		// Handle conversion to standalone task
		if (convert) {
			log.info(`Converting subtask ${subtaskId} to standalone task...`);

			try {
				// If the subtask has a parent, fetch the parent to get its epic link (if any)
				let epicKey = null;
				if (parentKey) {
					log.info(
						`Fetching parent task ${parentKey} to check for epic relationship...`
					);
					const parentResult = await jiraClient.fetchIssue(parentKey, { log });

					if (parentResult.success) {
						const parent = parentResult.data;

						// Check if parent has an epic link by looking at issue links
						if (parent.parentKey) {
							log.info(
								`Parent task has ${parent.dependencies.length} dependencies/links`
							);
							epicKey = parent.parentKey;
							log.info(`Found potential epic relationship: ${epicKey}`);
						}
					} else {
						log.warn(
							`Could not fetch parent task: ${parentResult.error?.message || 'Unknown error'}`
						);
					}
				}

				// Create a new JiraTicket for the standalone task
				const taskTicket = new JiraTicket({
					title: subtask.title,
					description: subtask.description,
					details: subtask.details,
					acceptanceCriteria: subtask.acceptanceCriteria,
					testStrategy: subtask.testStrategy,
					priority: subtask.priority,
					issueType: 'Task', // Convert to regular Task
					labels: subtask.labels || [],
					parentKey: epicKey
				});

				// Use the JiraClient's createIssue method instead of direct API call
				const createResult = await jiraClient.createIssue(taskTicket, { log });

				if (!createResult.success) {
					return createResult;
				}

				const newTaskKey = createResult.data.key;
				log.info(`Created new task ${newTaskKey} from subtask ${subtaskId}`);

				// After successful creation, get a client for direct API calls if needed
				const client = jiraClient.getClient();

				// Delete the original subtask
				await client.delete(`/rest/api/3/issue/${subtaskId}`);
				log.info(`Deleted original subtask ${subtaskId}`);

				// Return the result with the new task info
				return {
					success: true,
					data: {
						message: `Subtask ${subtaskId} successfully converted to task ${newTaskKey}`,
						originalSubtaskId: subtaskId,
						newTaskId: newTaskKey,
						epicLinked: epicKey,
						task: {
							id: newTaskKey,
							jiraKey: newTaskKey,
							title: subtask.title,
							status: subtask.status,
							priority: subtask.priority
						}
					}
				};
			} catch (error) {
				log.error(`Error converting subtask to task: ${error.message}`);
				return {
					success: false,
					error: {
						code: 'CONVERSION_ERROR',
						message: `Failed to convert subtask to task: ${error.message}`
					}
				};
			}
		} else {
			// Simple deletion
			log.info(`Deleting subtask ${subtaskId}...`);

			try {
				const client = jiraClient.getClient();
				await client.delete(`/rest/api/3/issue/${subtaskId}`);

				log.info(`Successfully deleted subtask ${subtaskId}`);
				return {
					success: true,
					data: {
						message: `Subtask ${subtaskId} successfully removed`,
						subtaskId
					}
				};
			} catch (error) {
				log.error(`Error deleting subtask: ${error.message}`);
				return {
					success: false,
					error: {
						code: 'DELETE_ERROR',
						message: `Failed to delete subtask: ${error.message}`
					}
				};
			}
		}
	} catch (error) {
		log.error(`Error in removeJiraSubtask: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'JIRA_API_ERROR',
				message: error.message
			}
		};
	}
}

/**
 * Removes a Jira task or subtask
 * @param {string} taskId - Jira issue key to remove (e.g., "PROJ-123")
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} - Result with success status and data/error
 */
export async function removeJiraTask(taskId, log) {
	try {
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

		log.info(`Removing Jira task ${taskId}`);

		// First, fetch the task to verify it exists and to get its details
		const taskResult = await jiraClient.fetchIssue(taskId, { log });

		if (!taskResult.success) {
			return {
				success: false,
				error: {
					code: 'TASK_NOT_FOUND',
					message: `Could not find task with key ${taskId}: ${taskResult.error?.message || 'Unknown error'}`
				}
			};
		}

		const task = taskResult.data;
		const isSubtask = task.issueType === 'Subtask';

		// If it's a subtask, delegate to removeJiraSubtask function
		if (isSubtask) {
			log.info(`Task ${taskId} is a subtask. Using removeJiraSubtask instead.`);
			return await removeJiraSubtask(taskId, false, log);
		}

		// Check if the task has subtasks
		let subtasks = [];
		try {
			const subtasksResult = await fetchTasksFromJira(taskId, false, log);
			if (subtasksResult.success && subtasksResult.tasks) {
				subtasks = subtasksResult.tasks;
				if (subtasks.length > 0) {
					log.info(
						`Task ${taskId} has ${subtasks.length} subtasks that need to be removed first`
					);
				}
			}
		} catch (error) {
			log.warn(`Error fetching subtasks for ${taskId}: ${error.message}`);
			// Continue without subtasks information - not fatal
		}

		// Get a direct client connection
		const client = jiraClient.getClient();

		// If the task has subtasks, delete them individually first
		const subtaskResults = [];
		let subtasksRemoved = 0;

		if (subtasks.length > 0) {
			log.info(
				`Deleting ${subtasks.length} subtasks before removing parent task ${taskId}`
			);

			for (const subtask of subtasks) {
				try {
					log.info(`Removing subtask ${subtask.id}...`);
					const subtaskResult = await removeJiraSubtask(subtask.id, false, log);

					if (subtaskResult.success) {
						subtasksRemoved++;
						subtaskResults.push({
							id: subtask.id,
							success: true,
							message: `Successfully removed subtask ${subtask.id}`
						});
						log.info(`Successfully removed subtask ${subtask.id}`);
					} else {
						subtaskResults.push({
							id: subtask.id,
							success: false,
							error: subtaskResult.error?.message || 'Unknown error'
						});
						log.warn(
							`Failed to remove subtask ${subtask.id}: ${subtaskResult.error?.message || 'Unknown error'}`
						);
					}
				} catch (subtaskError) {
					subtaskResults.push({
						id: subtask.id,
						success: false,
						error: subtaskError.message
					});
					log.error(
						`Error removing subtask ${subtask.id}: ${subtaskError.message}`
					);
				}
			}

			log.info(`Removed ${subtasksRemoved} out of ${subtasks.length} subtasks`);

			// Re-fetch subtasks to see if any are still remaining
			try {
				const remainingSubtasksResult = await fetchTasksFromJira(
					taskId,
					false,
					log
				);
				if (
					remainingSubtasksResult.success &&
					remainingSubtasksResult.tasks &&
					remainingSubtasksResult.tasks.length > 0
				) {
					const remainingCount = remainingSubtasksResult.tasks.length;
					log.warn(
						`There are still ${remainingCount} subtasks remaining that could not be deleted`
					);
				}
			} catch (error) {
				log.warn(`Could not verify remaining subtasks: ${error.message}`);
			}
		}

		// Now attempt to delete the parent task
		try {
			await client.delete(`/rest/api/3/issue/${taskId}`);
			log.info(`Successfully deleted task ${taskId}`);

			return {
				success: true,
				data: {
					message: `Task ${taskId} successfully removed along with ${subtasksRemoved} subtasks`,
					removedTask: task.toTaskMasterFormat(),
					subtasksRemoved: subtasksRemoved,
					subtaskResults: subtaskResults
				}
			};
		} catch (error) {
			log.error(`Error deleting parent task: ${error.message}`);

			// Check if it's a permission error
			if (error.response && error.response.status === 403) {
				return {
					success: false,
					error: {
						code: 'PERMISSION_ERROR',
						message: 'You do not have permission to delete this issue'
					}
				};
			}

			// Check if it's due to remaining subtasks
			if (
				error.response &&
				error.response.status === 400 &&
				error.response.data &&
				(error.response.data.errorMessages || []).some((msg) =>
					msg.includes('subtask')
				)
			) {
				return {
					success: false,
					error: {
						code: 'SUBTASKS_REMAINING',
						message: `Failed to delete task: ${error.message}. Some subtasks could not be deleted.`,
						subtaskResults: subtaskResults
					}
				};
			}

			return {
				success: false,
				error: {
					code: 'DELETE_ERROR',
					message: `Failed to delete task: ${error.message}`,
					subtaskResults: subtaskResults
				}
			};
		}
	} catch (error) {
		log.error(`Error in removeJiraTask: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'JIRA_API_ERROR',
				message: error.message
			}
		};
	}
}

/**
 * Analyze complexity of Jira tasks and generate a complexity report
 * @param {string} [parentKey] - Optional parent/epic key to filter tasks
 * @param {number} [threshold=5] - Minimum complexity score to recommend expansion
 * @param {boolean} [useResearch=false] - Whether to use Perplexity AI for research-backed analysis
 * @param {string} [outputPath] - Path to save the report file
 * @param {Object} options - Additional options
 * @param {string} [options.model] - LLM model to use for analysis
 * @param {Object} log - Logger object
 * @param {Object} [context={}] - Context object containing session data
 * @returns {Promise<{ success: boolean, data?: {Object}, error?: Object }>} - Result with success status and report data/error
 */
export async function analyzeJiraTaskComplexity(
	parentKey,
	threshold = 5,
	useResearch = false,
	outputPath,
	options = {},
	log,
	context = {}
) {
	try {
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

		log.info(
			`Analyzing complexity of Jira tasks ${parentKey ? `for parent ${parentKey}` : 'in project'}`
		);

		// First, fetch all tasks from Jira
		const tasksResult = await fetchTasksFromJira(parentKey, true, log);

		if (!tasksResult.success) {
			return tasksResult; // Return the error response
		}

		if (!tasksResult.tasks || tasksResult.tasks.length === 0) {
			return {
				success: false,
				error: {
					code: 'NO_TASKS_FOUND',
					message: 'No tasks found to analyze'
				}
			};
		}

		log.info(`Found ${tasksResult.tasks.length} tasks to analyze`);

		// Filter out tasks with status done/cancelled/deferred
		const activeStatuses = ['pending', 'blocked', 'in-progress'];
		const filteredTasks = tasksResult.tasks.filter((task) =>
			activeStatuses.includes(task.status?.toLowerCase() || 'pending')
		);

		if (filteredTasks.length === 0) {
			return {
				success: false,
				error: {
					code: 'NO_ACTIVE_TASKS',
					message:
						'No active tasks found to analyze (all tasks are completed, cancelled, or deferred)'
				}
			};
		}

		log.info(
			`Analyzing ${filteredTasks.length} active tasks (skipping ${tasksResult.tasks.length - filteredTasks.length} completed/cancelled/deferred tasks)`
		);

		// Convert the tasks to the format expected by analyzeTaskComplexity
		const tasksData = {
			tasks: filteredTasks,
			meta: {
				projectName: jiraClient.config.project,
				source: 'jira'
			},
			_originalTaskCount: tasksResult.tasks.length
		};

		// Import analyzeTaskComplexity function from task-manager.js
		const { analyzeTaskComplexity } = await import(
			'../../../../scripts/modules/task-manager.js'
		);

		// Create options for analyzeTaskComplexity
		const analyzeOptions = {
			_filteredTasksData: tasksData, // Pass pre-filtered data
			output: outputPath,
			model: options.model,
			threshold: threshold,
			research: useResearch
		};

		// Create a logger wrapper that matches the expected mcpLog interface
		const logWrapper = {
			info: (message) => log.info(message),
			warn: (message) => log.warn(message),
			error: (message) => log.error(message),
			debug: (message) => log.debug && log.debug(message),
			success: (message) => log.info(message) // Map success to info
		};

		// Call the core function with the prepared data
		await analyzeTaskComplexity(analyzeOptions, {
			session: context.session,
			mcpLog: logWrapper
		});

		// Read the report file
		const fs = await import('fs');
		const report = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

		// Calculate summary statistics
		const analysisArray = Array.isArray(report)
			? report
			: report.complexityAnalysis || [];
		const highComplexityTasks = analysisArray.filter(
			(t) => t.complexityScore >= 8
		).length;
		const mediumComplexityTasks = analysisArray.filter(
			(t) => t.complexityScore >= 5 && t.complexityScore < 8
		).length;
		const lowComplexityTasks = analysisArray.filter(
			(t) => t.complexityScore < 5
		).length;

		return {
			success: true,
			data: {
				message: `Task complexity analysis complete. Report saved to ${outputPath}`,
				reportPath: outputPath,
				reportSummary: {
					taskCount: analysisArray.length,
					highComplexityTasks,
					mediumComplexityTasks,
					lowComplexityTasks
				}
			}
		};
	} catch (error) {
		log.error(`Error analyzing Jira task complexity: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'JIRA_ANALYZE_ERROR',
				message: error.message
			}
		};
	}
}

/**
 * Generate subtasks for a task
 * @param {Object} task - Task to generate subtasks for
 * @param {number} numSubtasks - Number of subtasks to generate
 * @param {boolean} useResearch - Whether to use research for generating subtasks
 * @param {Object} options - Options object containing:
 *   - reportProgress: Function to report progress to MCP server (optional)
 *   - mcpLog: MCP logger object (optional)
 *   - session: Session object from MCP server (optional)
 * @returns {Array} Generated subtasks
 */
async function generateSubtasks(
	task,
	numSubtasks,
	useResearch = false,
	additionalContext = '',
	{ reportProgress, mcpLog, silentMode, session } = {}
) {
	try {
		// Check both global silentMode and the passed parameter
		const isSilent =
			silentMode || (typeof silentMode === 'undefined' && isSilentMode());

		// Use mcpLog if provided, otherwise use regular log if not silent
		const logFn = mcpLog
			? (level, ...args) => mcpLog[level](...args)
			: (level, ...args) => !isSilent && log(level, ...args);

		logFn(
			'info',
			`Generating ${numSubtasks} subtasks for task ${task.id}: ${task.title}`
		);

		// Only create loading indicators if not in silent mode
		let loadingIndicator = null;
		if (!isSilent) {
			loadingIndicator = startLoadingIndicator(
				`Generating subtasks for task ${task.id}...`
			);
		}

		let streamingInterval = null;
		let responseText = '';

		const systemPrompt = `You are an AI assistant helping with task breakdown for software development. 
You need to break down a high-level task into ${numSubtasks} specific subtasks that can be implemented one by one.

Subtasks should:
1. Be specific and actionable implementation steps
2. Follow a logical sequence
3. Each handle a distinct part of the parent task
4. Include clear guidance on implementation approach
5. Have appropriate dependency chains between subtasks
6. Collectively cover all aspects of the parent task

For each subtask, provide:
- A clear, specific title
- Detailed description of the task
- Dependencies on previous subtasks
- Testing approach

Each subtask should be implementable in a focused coding session.`;

		const contextPrompt = additionalContext
			? `\n\nAdditional context to consider: ${additionalContext}`
			: '';

		const userPrompt = `Please break down this task into ${numSubtasks} specific, actionable subtasks:

Task ID: ${task.id}
Title: ${task.title}
Description: ${task.description}
Current details: ${task.details || 'None provided'}
${contextPrompt}

Return exactly ${numSubtasks} subtasks with the following JSON structure:
[
    {
      "id": 1,
      "title": "Example Task Title",
      "description": "Detailed description of the task (if needed you can use markdown formatting, e.g. headings, lists, etc.)",
	  "acceptanceCriteria": "Detailed acceptance criteria for the task following typical Gherkin syntax",
      "status": "pending",
      "dependencies": [0],
      "priority": "high",
      "details": "Detailed implementation guidance",
      "testStrategy": "A Test Driven Development (TDD) approach for validating this task. Always specify TDD tests for each task if possible."
    },
    // ... more tasks ...
],

Note on dependencies: Subtasks can depend on other subtasks with lower IDs. Use an empty array if there are no dependencies.`;

		try {
			// Update loading indicator to show streaming progress
			// Only create if not in silent mode
			if (!isSilent) {
				let dotCount = 0;
				const readline = await import('readline');
				streamingInterval = setInterval(() => {
					readline.cursorTo(process.stdout, 0);
					process.stdout.write(
						`Generating subtasks for task ${task.id}${'.'.repeat(dotCount)}`
					);
					dotCount = (dotCount + 1) % 4;
				}, 500);
			}

			// Configure Anthropic client
			const anthropic = new Anthropic({
				apiKey: process.env.ANTHROPIC_API_KEY,
				// Add beta header for 128k token output
				defaultHeaders: {
					'anthropic-beta': 'output-128k-2025-02-19'
				}
			});

			// Use streaming API call
			const stream = await anthropic.messages.create({
				model: 'claude-3-7-sonnet-latest',
				max_tokens: session?.env?.MAX_TOKENS || 15000,
				temperature: session?.env?.TEMPERATURE || 0.4,
				system: systemPrompt,
				messages: [
					{
						role: 'user',
						content: userPrompt
					}
				],
				stream: true
			});

			// Process the stream
			for await (const chunk of stream) {
				if (chunk.type === 'content_block_delta' && chunk.delta.text) {
					responseText += chunk.delta.text;
				}
				if (reportProgress) {
					await reportProgress({
						progress: (responseText.length / session?.env?.MAX_TOKENS) * 100
					});
				}
			}

			if (streamingInterval) clearInterval(streamingInterval);
			if (loadingIndicator) stopLoadingIndicator(loadingIndicator);

			logFn('info', `Completed generating subtasks for task ${task.id}`);

			return parseSubtasksFromText(responseText, 1, numSubtasks, task.id);
		} catch (error) {
			if (streamingInterval) clearInterval(streamingInterval);
			if (loadingIndicator) stopLoadingIndicator(loadingIndicator);
			throw error;
		}
	} catch (error) {
		throw error;
	}
}

/**
 * Parse subtasks from Claude's response text
 * @param {string} text - Response text
 * @param {number} startId - Starting subtask ID
 * @param {number} expectedCount - Expected number of subtasks
 * @param {number} parentTaskId - Parent task ID
 * @returns {Array} Parsed subtasks
 * @throws {Error} If parsing fails or JSON is invalid
 */
function parseSubtasksFromText(text, startId, expectedCount, parentTaskId) {
	// Set default values for optional parameters
	startId = startId || 1;
	expectedCount = expectedCount || 2; // Default to 2 subtasks if not specified

	// Handle empty text case
	if (!text || text.trim() === '') {
		throw new Error('Empty text provided, cannot parse subtasks');
	}

	// Locate JSON array in the text
	const jsonStartIndex = text.indexOf('[');
	const jsonEndIndex = text.lastIndexOf(']');

	// If no valid JSON array found, throw error
	if (
		jsonStartIndex === -1 ||
		jsonEndIndex === -1 ||
		jsonEndIndex < jsonStartIndex
	) {
		throw new Error('Could not locate valid JSON array in the response');
	}

	// Extract and parse the JSON
	const jsonText = text.substring(jsonStartIndex, jsonEndIndex + 1);
	let subtasks;

	try {
		subtasks = JSON.parse(jsonText);
	} catch (parseError) {
		throw new Error(`Failed to parse JSON: ${parseError.message}`);
	}

	// Validate array
	if (!Array.isArray(subtasks)) {
		throw new Error('Parsed content is not an array');
	}

	// Log warning if count doesn't match expected
	if (expectedCount && subtasks.length !== expectedCount) {
		log(
			'warn',
			`Expected ${expectedCount} subtasks, but parsed ${subtasks.length}`
		);
	}

	// Normalize subtask IDs if they don't match
	subtasks = subtasks.map((subtask, index) => {
		// Assign the correct ID if it doesn't match
		if (!subtask.id || subtask.id !== startId + index) {
			log(
				'warn',
				`Correcting subtask ID from ${subtask.id || 'undefined'} to ${startId + index}`
			);
			subtask.id = startId + index;
		}

		// Convert dependencies to numbers if they are strings
		if (subtask.dependencies && Array.isArray(subtask.dependencies)) {
			subtask.dependencies = subtask.dependencies.map((dep) => {
				return typeof dep === 'string' ? parseInt(dep, 10) : dep;
			});
		} else {
			subtask.dependencies = [];
		}

		// Ensure status is 'pending'
		subtask.status = 'pending';

		// Add parentTaskId if provided
		if (parentTaskId) {
			subtask.parentTaskId = parentTaskId;
		}

		return subtask;
	});

	return subtasks;
}

/**
 * Compress image to ensure it's under 1MB for MCP image injection
 * @param {string} base64Data - Base64 encoded image data
 * @param {string} mimeType - Original MIME type of the image
 * @param {Object} log - Logger object
 * @returns {Promise<{base64: string, mimeType: string, originalSize: number, compressedSize: number}>}
 */
export async function compressImageIfNeeded(base64Data, mimeType, log) {
	const MAX_SIZE_BYTES = 1048576; // 1MB in bytes

	try {
		// Convert base64 to buffer
		const originalBuffer = Buffer.from(base64Data, 'base64');
		const originalSize = originalBuffer.length;

		log?.info(
			`Original image size: ${originalSize} bytes (${(originalSize / 1024 / 1024).toFixed(2)} MB)`
		);

		// If already under 1MB, return as is
		if (originalSize <= MAX_SIZE_BYTES) {
			log?.info('Image is already under 1MB, no compression needed');
			return {
				base64: base64Data,
				mimeType: mimeType,
				originalSize: originalSize,
				compressedSize: originalSize
			};
		}

		log?.info('Image exceeds 1MB, compressing...');

		// Start with quality 80% and reduce if needed
		let quality = 80;
		let compressedBuffer;
		let finalMimeType = 'image/jpeg'; // Convert to JPEG for better compression

		do {
			const sharpInstance = sharp(originalBuffer);

			// Convert to JPEG with specified quality
			compressedBuffer = await sharpInstance
				.jpeg({ quality: quality, progressive: true })
				.toBuffer();

			log?.info(
				`Compressed with quality ${quality}%: ${compressedBuffer.length} bytes`
			);

			// Reduce quality if still too large
			if (compressedBuffer.length > MAX_SIZE_BYTES && quality > 10) {
				quality -= 10;
			} else {
				break;
			}
		} while (compressedBuffer.length > MAX_SIZE_BYTES && quality >= 10);

		// If still too large, try resizing
		if (compressedBuffer.length > MAX_SIZE_BYTES) {
			log?.info('Still too large after quality reduction, trying resize...');

			const sharpInstance = sharp(originalBuffer);
			const metadata = await sharpInstance.metadata();

			// Reduce dimensions by 20% at a time
			let scale = 0.8;
			do {
				const newWidth = Math.floor(metadata.width * scale);
				const newHeight = Math.floor(metadata.height * scale);

				compressedBuffer = await sharp(originalBuffer)
					.resize(newWidth, newHeight)
					.jpeg({ quality: 70, progressive: true })
					.toBuffer();

				log?.info(
					`Resized to ${newWidth}x${newHeight}: ${compressedBuffer.length} bytes`
				);

				scale -= 0.1;
			} while (compressedBuffer.length > MAX_SIZE_BYTES && scale > 0.3);
		}

		const compressedBase64 = compressedBuffer.toString('base64');
		const compressedSize = compressedBuffer.length;

		log?.info(
			`Final compressed size: ${compressedSize} bytes (${(compressedSize / 1024 / 1024).toFixed(2)} MB)`
		);
		log?.info(
			`Compression ratio: ${((1 - compressedSize / originalSize) * 100).toFixed(1)}%`
		);

		return {
			base64: compressedBase64,
			mimeType: finalMimeType,
			originalSize: originalSize,
			compressedSize: compressedSize
		};
	} catch (error) {
		log?.error(`Error compressing image: ${error.message}`);
		// Return original image if compression fails
		return {
			base64: base64Data,
			mimeType: mimeType,
			originalSize: Buffer.from(base64Data, 'base64').length,
			compressedSize: Buffer.from(base64Data, 'base64').length,
			compressionFailed: true
		};
	}
}

/**
 * Relationship priority mapping for determining primary relationship
 */
export const RELATIONSHIP_PRIORITY = {
	subtask: 1,
	dependency: 2,
	child: 3,
	parent: 4,
	blocks: 5,
	related: 6
};

/**
 * Deduplicate tickets from subtasks and related context into a unified structure
 * @param {Array} subtasks - Array of subtask objects
 * @param {Object} relatedContext - Related context with tickets array
 * @param {Object} log - Logger instance
 * @returns {Object} - Unified structure with deduplicated tickets
 */
export function deduplicateTickets(subtasks, relatedContext, log) {
	const ticketMap = new Map();

	// Helper function to add or merge relationships
	const addTicketWithRelationship = (ticket, relationship) => {
		const ticketId = ticket.jiraKey || ticket.id;
		if (!ticketId) {
			log.warn('Ticket found without ID, skipping');
			return;
		}

		if (ticketMap.has(ticketId)) {
			// Merge relationships
			const existing = ticketMap.get(ticketId);
			const newRelationships = [...existing.relationships];

			// Check if this relationship type already exists
			const existingRelType = newRelationships.find(
				(r) => r.type === relationship.type
			);
			if (!existingRelType) {
				newRelationships.push(relationship);
			}

			// Update primary relationship if this one has higher priority
			const currentPrimaryPriority =
				RELATIONSHIP_PRIORITY[
					existing.relationships.find((r) => r.primary)?.type
				] || 999;
			const newRelationshipPriority =
				RELATIONSHIP_PRIORITY[relationship.type] || 999;

			if (newRelationshipPriority < currentPrimaryPriority) {
				// Set all existing to non-primary
				newRelationships.forEach((r) => (r.primary = false));
				// Set new one as primary
				const newRel = newRelationships.find(
					(r) => r.type === relationship.type
				);
				if (newRel) newRel.primary = true;
			}

			existing.relationships = newRelationships;

			// Merge pull requests - preserve the most detailed version
			const newPRs = ticket.pullRequests || [];
			if (newPRs.length > 0) {
				// Merge PRs by ID, keeping the most detailed version
				const prMap = new Map();

				// Add existing PRs to map
				(existing.pullRequests || []).forEach((pr) => {
					if (pr.id) {
						prMap.set(pr.id, pr);
					}
				});

				// Add/merge new PRs, preferring more detailed versions
				newPRs.forEach((pr) => {
					if (pr.id) {
						const existingPR = prMap.get(pr.id);
						if (!existingPR) {
							// New PR, add it
							prMap.set(pr.id, pr);
						} else {
							// PR exists, merge keeping the most detailed version
							// Prefer PR with diffstat/filesChanged data
							const hasNewDiffstat = pr.diffStat || pr.filesChanged;
							const hasExistingDiffstat =
								existingPR.diffStat || existingPR.filesChanged;

							if (hasNewDiffstat && !hasExistingDiffstat) {
								// New PR has diffstat, existing doesn't - use new
								prMap.set(pr.id, pr);
							} else if (!hasNewDiffstat && hasExistingDiffstat) {
								// Keep existing PR with diffstat
								// Do nothing
							} else {
								// Both have diffstat or neither has it - merge properties
								prMap.set(pr.id, {
									...existingPR,
									...pr,
									// Preserve detailed data from whichever has it
									diffStat: pr.diffStat || existingPR.diffStat,
									filesChanged:
										pr.filesChanged || existingPR.filesChanged,
									commits: pr.commits || existingPR.commits
								});
							}
						}
					}
				});

				existing.pullRequests = Array.from(prMap.values());
			}
		} else {
			// Add new ticket
			ticketMap.set(ticketId, {
				ticket,
				relationships: [
					{
						...relationship,
						primary: true
					}
				],
				pullRequests: ticket.pullRequests || [],
				relevanceScore: ticket.relevanceScore || 100
			});
		}
	};

	// Process subtasks first (highest priority)
	if (subtasks && Array.isArray(subtasks)) {
		subtasks.forEach((subtask) => {
			addTicketWithRelationship(subtask, {
				type: 'subtask',
				direction: 'child',
				depth: 1
			});
		});
		log.info(`Processed ${subtasks.length} subtasks`);
	}

	// Process related context tickets
	if (
		relatedContext &&
		relatedContext.tickets &&
		Array.isArray(relatedContext.tickets)
	) {
		relatedContext.tickets.forEach((contextItem) => {
			const ticket = contextItem.ticket;
			if (ticket) {
				// Create a ticket object with PR data attached for proper merging
				const ticketWithPRs = {
					...ticket,
					pullRequests: contextItem.pullRequests || [],
					relevanceScore: contextItem.relevanceScore || 100
				};

				addTicketWithRelationship(ticketWithPRs, {
					type: contextItem.relationship || 'related',
					direction: contextItem.direction || 'unknown',
					depth: contextItem.depth || 1
				});
			}
		});
		log.info(
			`Processed ${relatedContext.tickets.length} related context tickets`
		);
	}

	// Convert map to array and calculate summary
	const relatedTickets = Array.from(ticketMap.values());

	// Calculate relationship summary
	const relationshipSummary = {
		subtasks: relatedTickets.filter((t) =>
			t.relationships.some((r) => r.type === 'subtask')
		).length,
		dependencies: relatedTickets.filter((t) =>
			t.relationships.some((r) => r.type === 'dependency')
		).length,
		relatedTickets: relatedTickets.filter((t) =>
			t.relationships.some((r) => r.type === 'related')
		).length,
		totalUnique: relatedTickets.length
	};

	// Preserve original context summary if available
	const contextSummary = relatedContext?.summary || {
		overview: `Found ${relationshipSummary.totalUnique} unique related tickets`,
		recentActivity: 'No activity information available',
		completedWork: `${relatedTickets.filter((t) => t.ticket.status === 'done' || t.ticket.status === 'Done').length} tickets completed`,
		implementationInsights: []
	};

	log.info(
		`Deduplicated to ${relationshipSummary.totalUnique} unique tickets from ${(subtasks?.length || 0) + (relatedContext?.tickets?.length || 0)} total`
	);

	return {
		relatedTickets,
		relationshipSummary,
		contextSummary
	};
}

/**
 * Extract attachment images from context tickets and remove them from the context
 * @param {Object} relatedContext - The related context object containing tickets
 * @param {Object} log - Logger instance
 * @returns {Array} Array of extracted image objects
 */
export function extractAndRemoveContextImages(relatedContext, log) {
	const contextImages = [];

	if (!relatedContext || !relatedContext.tickets) {
		return contextImages;
	}

	// Process each context ticket
	relatedContext.tickets.forEach((contextTicketWrapper, ticketIndex) => {
		// The structure is: contextTicketWrapper.ticket.attachmentImages
		// We need to check and remove from the nested ticket object
		if (
			contextTicketWrapper.ticket &&
			contextTicketWrapper.ticket.attachmentImages &&
			Array.isArray(contextTicketWrapper.ticket.attachmentImages)
		) {
			const imageCount = contextTicketWrapper.ticket.attachmentImages.length;

			// Extract images and add metadata about source ticket
			contextTicketWrapper.ticket.attachmentImages.forEach(
				(image, imageIndex) => {
					contextImages.push({
						...image,
						sourceTicket:
							contextTicketWrapper.ticket.key ||
							`context-ticket-${ticketIndex}`,
						sourceTicketSummary:
							contextTicketWrapper.ticket.summary || 'Unknown',
						contextIndex: ticketIndex,
						imageIndex: imageIndex
					});
				}
			);

			// Remove the attachmentImages array from the nested ticket object
			delete contextTicketWrapper.ticket.attachmentImages;
			log.info(
				`Extracted ${imageCount} images from context ticket ${contextTicketWrapper.ticket.key}`
			);
		}

		// Also check the wrapper level (for backwards compatibility)
		if (
			contextTicketWrapper.attachmentImages &&
			Array.isArray(contextTicketWrapper.attachmentImages)
		) {
			const imageCount = contextTicketWrapper.attachmentImages.length;

			// Extract images and add metadata about source ticket
			contextTicketWrapper.attachmentImages.forEach((image, imageIndex) => {
				contextImages.push({
					...image,
					sourceTicket:
						contextTicketWrapper.key || `context-ticket-${ticketIndex}`,
					sourceTicketSummary: contextTicketWrapper.summary || 'Unknown',
					contextIndex: ticketIndex,
					imageIndex: imageIndex
				});
			});

			// Remove the attachmentImages array from the wrapper
			delete contextTicketWrapper.attachmentImages;
			log.info(
				`Extracted ${imageCount} images from context ticket wrapper ${contextTicketWrapper.key}`
			);
		}
	});

	return contextImages;
}

/**
 * Add context to a JiraTicket if context services are available
 * @param {JiraTicket} ticket - The ticket to enhance with context
 * @param {string} ticketId - The ticket ID for context lookup
 * @param {number} maxRelatedTickets - Maximum number of related tickets to fetch
 * @param {boolean} withSubtasks - Whether subtasks are included
 * @param {Object} log - Logger instance
 */
export async function addContextToTask(
	ticket,
	ticketId,
	maxRelatedTickets,
	withSubtasks,
	log
) {
	try {
		// Check if context services are available
		const jiraClient = new JiraClient();
		if (!jiraClient.isReady()) {
			log.info('Jira client not ready, skipping context');
			return;
		}

		const bitbucketClient = new BitbucketClient();
		if (!bitbucketClient.enabled) {
			log.info('Bitbucket client not enabled, skipping context');
			return;
		}

		// Initialize context services
		const relationshipResolver = new JiraRelationshipResolver(jiraClient);
		const prMatcher = new PRTicketMatcher(bitbucketClient, jiraClient);
		const contextAggregator = new ContextAggregator(
			relationshipResolver,
			bitbucketClient,
			prMatcher
		);

		log.info(`Fetching context for ticket ${ticketId}...`);

		// Extract repository information from ticket's development info if available
		let detectedRepositories = [];

		// Try to get repository info from development status first
		if (contextAggregator.prMatcher) {
			try {
				const devStatusResult =
					await contextAggregator.prMatcher.getJiraDevStatus(ticketId);
				if (devStatusResult.success && devStatusResult.data) {
					// Extract unique repository names from PRs
					const repoNames = devStatusResult.data
						.filter((pr) => pr.repository)
						.map((pr) => {
							// Handle both full paths and repo names
							const repo = pr.repository;
							return repo.includes('/') ? repo.split('/')[1] : repo;
						})
						.filter((repo, index, arr) => arr.indexOf(repo) === index); // Remove duplicates

					detectedRepositories = repoNames;
					log.info(
						`Detected repositories from development info: ${detectedRepositories.join(', ')}`
					);
				}
			} catch (devError) {
				log.warn(
					`Could not detect repositories from development info: ${devError.message}`
				);
			}
		}

		// Get context with configurable maxRelated parameter
		// Use detected repositories for more targeted PR searches
		const contextPromise = contextAggregator.aggregateContext(ticketId, {
			depth: 2,
			maxRelated: maxRelatedTickets,
			detectedRepositories: detectedRepositories, // Pass detected repos for smarter PR matching
			log: {
				info: (msg) => log.info(msg),
				warn: (msg) => log.warn(msg),
				error: (msg) => log.error(msg),
				debug: (msg) =>
					log.debug ? log.debug(msg) : log.info(`[DEBUG] ${msg}`) // Fallback for debug
			}
		});

		// 30-second timeout for context retrieval (matches working test)
		const timeoutPromise = new Promise((_, reject) =>
			setTimeout(() => reject(new Error('Context retrieval timeout')), 30000)
		);

		// CRITICAL FIX: Fetch main ticket PR data BEFORE context aggregation and deduplication
		// This ensures the main ticket's PR data is available during deduplication
		if (!ticket.pullRequests || ticket.pullRequests.length === 0) {
			log.info(
				`Main ticket ${ticketId} has no PR data, fetching from development status...`
			);

			try {
				// Get PRs for the main ticket from Jira dev status
				const mainTicketPRs = await prMatcher.getJiraDevStatus(ticketId);

				if (
					mainTicketPRs.success &&
					mainTicketPRs.data &&
					mainTicketPRs.data.length > 0
				) {
					// The PRs are already enhanced by getJiraDevStatus
					ticket.pullRequests = mainTicketPRs.data;
					log.info(
						`Added ${mainTicketPRs.data.length} PRs to main ticket ${ticketId} BEFORE deduplication`
					);

					// Debug log PR details
					mainTicketPRs.data.forEach((pr) => {
						log.info(
							`Main ticket PR ${pr.id}: has diffStat=${!!pr.diffStat}, has filesChanged=${!!pr.filesChanged}`
						);
						if (pr.diffStat) {
							log.info(
								`  - Additions: ${pr.diffStat.additions}, Deletions: ${pr.diffStat.deletions}`
							);
						}
						if (pr.filesChanged) {
							log.info(`  - Files changed: ${pr.filesChanged.length}`);
						}
					});
				}
			} catch (prError) {
				log.warn(`Failed to fetch PR data for main ticket: ${prError.message}`);
			}
		}

		const context = await Promise.race([contextPromise, timeoutPromise]);

		if (context && context.relatedContext) {
			// Extract attachment images from context tickets before processing
			const contextImages = extractAndRemoveContextImages(
				context.relatedContext,
				log
			);

			// Apply deduplication between subtasks and related context
			const deduplicatedData = deduplicateTickets(
				ticket.subtasks,
				context.relatedContext,
				log
			);

			// Replace the original structure with the unified deduplicated structure
			ticket.relatedTickets = deduplicatedData.relatedTickets;
			ticket.relationshipSummary = deduplicatedData.relationshipSummary;
			ticket.contextSummary = deduplicatedData.contextSummary;

			// Remove the old separate subtasks field since we now have unified relatedTickets
			// This eliminates duplication between subtasks and relatedTickets
			if (ticket.subtasks) {
				delete ticket.subtasks;
			}

			// Store context images for later use in the response
			if (contextImages.length > 0) {
				ticket._contextImages = contextImages;
				log.info(
					`Extracted ${contextImages.length} images from context tickets`
				);
			}
		} else {
			log.info('No context returned or no relatedContext property');
		}
	} catch (error) {
		log.warn(`Context retrieval failed: ${error.message}`);
		// Don't throw - context failure shouldn't break main functionality
	}
}
