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
			execute: withNormalizedProjectRoot(
				async (args, { log, session }, projectRoot) => {
					try {
						log.info(`Session object received in execute: ${JSON.stringify(session)}`);

						log.info(`Getting task details for ID: ${args.id}`);

						const result = await showTaskDirect(
							{
								...args,
								projectRoot
							},
							log
						);

						if (result.success) {
							// Ensure we return just the task data without allTasks
							const processedData = processTaskResponse(result.data);
							log.info(`Successfully retrieved task ${args.id}.`);
							return handleApiResult({ ...result, data: processedData }, log);
						} else {
							log.error(
								`Failed to get task: ${result.error?.message || 'Unknown error'}`
							);
							return handleApiResult(result, log);
						}
					} catch (error) {
						log.error(`Error in get-task tool: ${error.message}`);
						return createErrorResponse(error.message);
					}
				}
			)
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
					),
				includeContext: z
					.boolean()
					.optional()
					.default(true)
					.describe('If true, will include related tickets and PR context (default: true)'),
				maxRelatedTickets: z
					.number()
					.min(1)
					.max(50)
					.optional()
					.default(10)
					.describe('Maximum number of related tickets to fetch in context (default: 10, max: 50)')
			}),
			execute: async (args, { log, session }) => {
				log.info(`Session object received in execute: ${JSON.stringify(session)}`);

				try {
					log.info(`Getting Jira task details for ID: ${args.id}${args.includeImages === false ? ' (excluding images)' : ''}${args.includeContext === false ? ' (excluding context)' : args.maxRelatedTickets !== 10 ? ` (max ${args.maxRelatedTickets} related)` : ''}`);

					// Get the base task data first, now with context handling inside
					const result = await showJiraTaskDirect(
						{
							id: args.id,
							withSubtasks: args.withSubtasks,
							includeImages: args.includeImages,
							includeContext: args.includeContext,
							maxRelatedTickets: args.maxRelatedTickets
						},
						log
					);

					if (!result.success) {
						return createErrorResponse(`Failed to fetch task: ${result.error?.message || 'Unknown error'}`);
					}

					// return {
					// 	content: [{
					// 		type: 'text',
					// 		text: JSON.stringify(result, null, 2)
					// 	}]
					// };

					const task = result.data.task;

					// Extract context images before formatting response
					let contextImages = [];
					if (task._contextImages && task._contextImages.length > 0) {
						contextImages = task._contextImages;
						// Clean up the temporary context images from the ticket object BEFORE JSON.stringify
						delete task._contextImages;
					}

					// Rest of existing response formatting logic...
					const content = [];
					content.push({
						type: 'text',
						text: typeof task === 'object'
							? JSON.stringify(task, null, 2)
							: String(task)
					});

					// Add main ticket images to the content array
					if (result.data.images && result.data.images.length > 0) {
						for (let i = 0; i < result.data.images.length; i++) {
							const imageData = result.data.images[i];

							// Add image description - filename should now be directly on imageData
							content.push({
								type: 'text',
								text: `Main Ticket Image ${i + 1}: ${imageData.filename || 'Unknown filename'} (${imageData.mimeType}, ${Math.round(imageData.size / 1024)}KB${imageData.isThumbnail ? ', thumbnail' : ''})`
							});

							// Add the actual image
							content.push({
								type: 'image',
								data: imageData.base64,
								mimeType: imageData.mimeType
							});
						}
					}

					// Add context images to the content array
					if (contextImages.length > 0) {
						for (let i = 0; i < contextImages.length; i++) {
							const imageData = contextImages[i];

							// Add image description with source ticket info
							content.push({
								type: 'text',
								text: `Context Image ${i + 1} from ${imageData.sourceTicket} (${imageData.sourceTicketSummary}): ${imageData.filename || 'Unknown filename'} (${imageData.mimeType}, ${Math.round(imageData.size / 1024)}KB${imageData.isThumbnail ? ', thumbnail' : ''})`
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
					log.error(`Error in get-jira-task tool: ${error.message}\n${error.stack}`);
					return createErrorResponse(`Failed to get task: ${error.message}`);
				}
			}
		});
	}
}
