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
import { ContextAggregator } from '../core/utils/context-aggregator.js';
import { JiraRelationshipResolver } from '../core/utils/jira-relationship-resolver.js';
import { BitbucketClient } from '../core/utils/bitbucket-client.js';
import { PRTicketMatcher } from '../core/utils/pr-ticket-matcher.js';

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
					),
				includeContext: z
					.boolean()
					.optional()
					.default(true)
					.describe('If true, will include related tickets and PR context (default: true)')
			}),
			execute: async (args, { log, session }) => {
				log.info(`Session object received in execute: ${JSON.stringify(session)}`);

				try {
					log.info(`Getting Jira task details for ID: ${args.id}${args.includeImages === false ? ' (excluding images)' : ''}${args.includeContext === false ? ' (excluding context)' : ''}`);

					// Get the base task data first
					const result = await showJiraTaskDirect(
						{
							id: args.id,
							withSubtasks: args.withSubtasks,
							includeImages: args.includeImages
						},
						log
					);

					if (!result.success) {
						return createErrorResponse(`Failed to fetch task: ${result.error?.message || 'Unknown error'}`);
					}

					// Add context if requested and available
					if (args.includeContext !== false) {
						try {
							// Add debug info to the ticket so we can see it in the response
							result.data.task.contextDebug = { started: true, timestamp: new Date().toISOString() };
							await addContextToTask(result.data.task, args.id, log);
						} catch (contextError) {
							// Context failure should not break the main functionality
							log.warn(`Failed to add context to task ${args.id}: ${contextError.message}`);
							result.data.task.contextDebug = { 
								...result.data.task.contextDebug, 
								error: contextError.message,
								stack: contextError.stack 
							};
							// Continue without context
						}
					}

					// Rest of existing response formatting logic...
					const content = [];
					content.push({
						type: 'text',
						text: typeof result.data.task === 'object'
							? JSON.stringify(result.data.task, null, 2)
							: String(result.data.task)
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
					log.error(`Error in get-jira-task tool: ${error.message}\n${error.stack}`);
					return createErrorResponse(`Failed to get task: ${error.message}`);
				}
			}
		});
	}
}

/**
 * Add context to a JiraTicket if context services are available
 * @param {JiraTicket} ticket - The ticket to enhance with context
 * @param {string} ticketId - The ticket ID for context lookup
 * @param {Object} log - Logger instance
 */
async function addContextToTask(ticket, ticketId, log) {
	try {
		log.info(`[DEBUG] Starting addContextToTask for ticket ${ticketId}`);
		ticket.contextDebug = { ...ticket.contextDebug, step: 'starting' };
		
		// Check if context services are available
		log.info(`[DEBUG] Creating JiraClient...`);
		const jiraClient = new JiraClient();
		log.info(`[DEBUG] JiraClient created, checking if ready...`);
		ticket.contextDebug = { ...ticket.contextDebug, step: 'jira_client_check', jiraReady: jiraClient.isReady() };
		
		if (!jiraClient.isReady()) {
			log.warn(`[DEBUG] Jira client not ready, skipping context`);
			ticket.contextDebug = { ...ticket.contextDebug, step: 'jira_not_ready', reason: 'Jira client not ready' };
			return;
		}
		log.info(`[DEBUG] ✅ Jira client is ready`);

		log.info(`[DEBUG] Creating BitbucketClient...`);
		const bitbucketClient = new BitbucketClient();
		log.info(`[DEBUG] BitbucketClient created, checking if ready...`);
		log.info(`[DEBUG] BitbucketClient.enabled: ${bitbucketClient.enabled}`);
		log.info(`[DEBUG] BitbucketClient.client: ${!!bitbucketClient.client}`);
		log.info(`[DEBUG] BitbucketClient.error: ${bitbucketClient.error}`);
		
		// Add environment variable debugging
		const bitbucketEnvVars = {
			BITBUCKET_WORKSPACE: process.env.BITBUCKET_WORKSPACE,
			BITBUCKET_USERNAME: process.env.BITBUCKET_USERNAME,
			BITBUCKET_API_TOKEN: process.env.BITBUCKET_API_TOKEN ? '[SET]' : '[NOT SET]',
			BITBUCKET_DEFAULT_REPO: process.env.BITBUCKET_DEFAULT_REPO
		};
		
		// Test the static method directly
		let staticEnabledCheck, staticConfig;
		try {
			staticEnabledCheck = BitbucketClient.isBitbucketEnabled();
			staticConfig = BitbucketClient.getBitbucketConfig();
		} catch (staticError) {
			staticEnabledCheck = `ERROR: ${staticError.message}`;
			staticConfig = `ERROR: ${staticError.message}`;
		}
		
		ticket.contextDebug = { 
			...ticket.contextDebug, 
			step: 'bitbucket_client_check', 
			bitbucketEnabled: bitbucketClient.enabled,
			bitbucketHasClient: !!bitbucketClient.client,
			bitbucketError: bitbucketClient.error,
			bitbucketReady: bitbucketClient.isReady(),
			bitbucketEnvVars: bitbucketEnvVars,
			staticEnabledCheck: staticEnabledCheck,
			staticConfig: typeof staticConfig === 'object' ? {
				workspace: staticConfig.workspace,
				username: staticConfig.username,
				apiToken: staticConfig.apiToken ? '[SET]' : '[NOT SET]',
				defaultRepo: staticConfig.defaultRepo
			} : staticConfig
		};
		
		if (!bitbucketClient.isReady()) {
			log.warn(`[DEBUG] Bitbucket client not ready, skipping context. Enabled: ${bitbucketClient.enabled}, Client: ${!!bitbucketClient.client}, Error: ${bitbucketClient.error}`);
			ticket.contextDebug = { 
				...ticket.contextDebug, 
				step: 'bitbucket_not_ready', 
				reason: `Bitbucket not ready. Enabled: ${bitbucketClient.enabled}, Client: ${!!bitbucketClient.client}, Error: ${bitbucketClient.error}`
			};
			return;
		}
		log.info(`[DEBUG] ✅ Bitbucket client is ready`);

		// Initialize context services
		log.info(`[DEBUG] Initializing context services...`);
		const relationshipResolver = new JiraRelationshipResolver(jiraClient);
		const prMatcher = new PRTicketMatcher(bitbucketClient, jiraClient);
		const contextAggregator = new ContextAggregator(relationshipResolver, bitbucketClient, prMatcher);
		log.info(`[DEBUG] ✅ Context services initialized`);
		ticket.contextDebug = { 
			...ticket.contextDebug, 
			step: 'services_initialized',
			ticketForContext: {
				jiraKey: ticket.jiraKey,
				parentKey: ticket.parentKey,
				issueType: ticket.issueType,
				hasParentKey: !!ticket.parentKey,
				ticketKeys: Object.keys(ticket)
			}
		};

		log.info(`[DEBUG] Fetching context for ticket ${ticketId}...`);

		// Get context with reasonable timeout
		const contextOptions = {
			depth: 2,
			maxRelated: 15, // Limit for performance
			repoSlug: process.env.BITBUCKET_DEFAULT_REPO,
			log // Pass the logger to the context aggregator
		};
		log.info(`[DEBUG] Context options: ${JSON.stringify(contextOptions)}`);
		ticket.contextDebug = { ...ticket.contextDebug, step: 'starting_aggregation', contextOptions };
		
		const contextPromise = contextAggregator.aggregateContext(ticketId, contextOptions);

		// 5-second timeout for context retrieval
		const timeoutPromise = new Promise((_, reject) =>
			setTimeout(() => reject(new Error('Context retrieval timeout')), 5000)
		);

		log.info(`[DEBUG] Starting context aggregation with 5s timeout...`);
		const context = await Promise.race([contextPromise, timeoutPromise]);
		log.info(`[DEBUG] Context aggregation completed. Has debugInfo: ${!!context?.debugInfo}`);
		log.info(`[DEBUG] Context debugInfo: ${JSON.stringify(context?.debugInfo, null, 2)}`);
		ticket.contextDebug = { 
			...ticket.contextDebug, 
			step: 'aggregation_complete', 
			hasContext: !!context,
			contextHasDebugInfo: !!context?.debugInfo,
			contextDebugInfo: context?.debugInfo,
			contextResult: context // Add the full context result for debugging
		};

		if (context && context.relatedContext) {
			log.info(`[DEBUG] Adding context to ticket...`);
			// Add context directly to the ticket object since it might not be a JiraTicket instance
			if (typeof ticket.addContext === 'function') {
				ticket.addContext(context.relatedContext);
			} else {
				// Fallback: add context directly to the object
				ticket.relatedContext = context.relatedContext;
			}
			log.info(`[DEBUG] ✅ Added context with ${context.relatedContext.summary.totalRelated} related items`);
			ticket.contextDebug = { ...ticket.contextDebug, step: 'context_added', totalRelated: context.relatedContext.summary.totalRelated };
		} else {
			log.warn(`[DEBUG] No context returned or no relatedContext property`);
			ticket.contextDebug = { ...ticket.contextDebug, step: 'no_context', context: context };
		}

	} catch (error) {
		log.error(`[DEBUG] Context retrieval failed: ${error.message}`);
		log.error(`[DEBUG] Error stack: ${error.stack}`);
		ticket.contextDebug = { 
			...ticket.contextDebug, 
			step: 'error', 
			error: error.message, 
			stack: error.stack 
		};
		// Don't throw - context failure shouldn't break main functionality
	}
}
