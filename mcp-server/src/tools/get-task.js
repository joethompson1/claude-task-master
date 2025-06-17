/**
 * tools/get-task.js
 * Tool to get task details by ID
 */

import { z } from 'zod';
import {
	handleApiResult,
	createErrorResponse,
	withNormalizedProjectRoot
} from './utils.js';
import {
	showTaskDirect,
	showJiraTaskDirect
} from '../core/task-master-core.js';
import { findTasksJsonPath } from '../core/utils/path-utils.js';
import { JiraClient } from '../core/utils/jira-client.js';

/**
 * Custom processor function that removes allTasks from the response
 * @param {Object} data - The data returned from showTaskDirect
 * @returns {Object} - The processed data with allTasks removed
 */
function processTaskResponse(data) {
	if (!data) return data;

	// If we have the expected structure with task and allTasks
	if (typeof data === 'object' && data !== null && data.id && data.title) {
		// If the data itself looks like the task object, return it
		return data;
	} else if (data.task) {
		return data.task;
	}

	// If structure is unexpected, return as is
	return data;
}

/**
 * Register the get-task tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerShowTaskTool(server) {
	if (!JiraClient.isJiraEnabled()) {
		server.addTool({
			name: 'get_task',
			description: 'Get detailed information about a specific task',
			parameters: z.object({
				id: z.string().describe('Task ID to get'),
				status: z
					.string()
					.optional()
					.describe("Filter subtasks by status (e.g., 'pending', 'done')"),
				file: z
					.string()
					.optional()
					.describe('Path to the tasks file relative to project root'),
				projectRoot: z
					.string()
					.optional()
					.describe(
						'Absolute path to the project root directory (Optional, usually from session)'
					)
			}),
			execute: withNormalizedProjectRoot(async (args, { log }) => {
				const { id, file, status, projectRoot } = args;

				try {
					log.info(
						`Getting task details for ID: ${id}${status ? ` (filtering subtasks by status: ${status})` : ''} in root: ${projectRoot}`
					);

					// Resolve the path to tasks.json using the NORMALIZED projectRoot from args
					let tasksJsonPath;
					try {
						tasksJsonPath = findTasksJsonPath(
							{ projectRoot: projectRoot, file: file },
							log
						);
						log.info(`Resolved tasks path: ${tasksJsonPath}`);
					} catch (error) {
						log.error(`Error finding tasks.json: ${error.message}`);
						return createErrorResponse(
							`Failed to find tasks.json: ${error.message}`
						);
					}

					// Call the direct function, passing the normalized projectRoot
					const result = await showTaskDirect(
						{
							tasksJsonPath: tasksJsonPath,
							id: id,
							status: status,
							projectRoot: projectRoot
						},
						log
					);

					if (result.success) {
						log.info(
							`Successfully retrieved task details for ID: ${args.id}${result.fromCache ? ' (from cache)' : ''}`
						);
					} else {
						log.error(`Failed to get task: ${result.error.message}`);
					}

					// Use our custom processor function
					return handleApiResult(
						result,
						log,
						'Error retrieving task details',
						processTaskResponse
					);
				} catch (error) {
					log.error(`Error in get-task tool: ${error.message}\n${error.stack}`);
					return createErrorResponse(`Failed to get task: ${error.message}`);
				}
			})
		});
	} else {
		server.addTool({
			name: 'get_jira_task',
			description: 'Get detailed information about a specific Jira task',
			parameters: z.object({
				id: z
					.string()
					.describe(
						'Task ID to get (Important: Make sure to include the project prefix, e.g. PROJ-123)'
					),
				withSubtasks: z
					.boolean()
					.optional()
					.default(false)
					.describe('If true, will fetch subtasks for the parent task'),
				includeImages: z
					.boolean()
					.optional()
					.default(true)
					.describe(
						'If true, will fetch and include image attachments (default: true)'
					)
			}),
			execute: async (args, { log, session }) => {
				// Log the session right at the start of execute
				log.info(
					`Session object received in execute: ${JSON.stringify(session)}`
				); // Use JSON.stringify for better visibility

				try {
					log.info(
						`Getting Jira task details for ID: ${args.id}${args.includeImages === false ? ' (excluding images)' : ''}`
					);

					const result = await showJiraTaskDirect(
						{
							// Only need to pass the ID for Jira tasks
							id: args.id,
							withSubtasks: args.withSubtasks,
							includeImages: args.includeImages
						},
						log
					);

					const content = [];
					content.push({
						type: 'text',
						text:
							typeof result.data.task === 'object'
								? // Format JSON nicely with indentation
									JSON.stringify(result.data.task, null, 2)
								: // Keep other content types as-is
									String(result.data.task)
					});

					// Add each image to the content array (only if images were fetched)
					if (result.data.images && result.data.images.length > 0) {
						for (let i = 0; i < result.data.images.length; i++) {
							const imageData = result.data.images[i];

							// Add image description - filename should now be directly on imageData
							content.push({
								type: 'text',
								text: `Image ${i + 1}: ${imageData.filename || 'Unknown filename'} (${imageData.mimeType}, ${Math.round(imageData.size / 1024)}KB${imageData.isThumbnail ? ', thumbnail' : ''})`
							});

							// Add the actual image
							content.push({
								type: 'image',
								data: imageData.base64,
								mimeType: imageData.mimeType
							});
						}
					}

					return { content };
				} catch (error) {
					log.error(
						`Error in get-jira-task tool: ${error.message}\n${error.stack}`
					); // Add stack trace
					return createErrorResponse(
						`Failed to get Jira task: ${error.message}`
					);
				}
			}
		});
	}
}
