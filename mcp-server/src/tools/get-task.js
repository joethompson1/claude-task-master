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
 * Relationship priority mapping for determining primary relationship
 */
const RELATIONSHIP_PRIORITY = {
	'subtask': 1,
	'dependency': 2, 
	'child': 3,
	'parent': 4,
	'blocks': 5,
	'related': 6
};

/**
 * Deduplicate tickets from subtasks and related context into a unified structure
 * @param {Array} subtasks - Array of subtask objects
 * @param {Object} relatedContext - Related context with tickets array
 * @param {Object} log - Logger instance
 * @returns {Object} - Unified structure with deduplicated tickets
 */
function deduplicateTickets(subtasks, relatedContext, log) {
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
			const existingRelType = newRelationships.find(r => r.type === relationship.type);
			if (!existingRelType) {
				newRelationships.push(relationship);
			}
			
			// Update primary relationship if this one has higher priority
			const currentPrimaryPriority = RELATIONSHIP_PRIORITY[existing.relationships.find(r => r.primary)?.type] || 999;
			const newRelationshipPriority = RELATIONSHIP_PRIORITY[relationship.type] || 999;
			
			if (newRelationshipPriority < currentPrimaryPriority) {
				// Set all existing to non-primary
				newRelationships.forEach(r => r.primary = false);
				// Set new one as primary
				const newRel = newRelationships.find(r => r.type === relationship.type);
				if (newRel) newRel.primary = true;
			}
			
			existing.relationships = newRelationships;
			
			// Merge pull requests - preserve the most detailed version
			const newPRs = ticket.pullRequests || [];
			if (newPRs.length > 0) {
				// Merge PRs by ID, keeping the most detailed version
				const prMap = new Map();
				
				// Add existing PRs to map
				(existing.pullRequests || []).forEach(pr => {
					if (pr.id) {
						prMap.set(pr.id, pr);
					}
				});
				
				// Add/merge new PRs, preferring more detailed versions
				newPRs.forEach(pr => {
					if (pr.id) {
						const existingPR = prMap.get(pr.id);
						if (!existingPR) {
							// New PR, add it
							prMap.set(pr.id, pr);
						} else {
							// PR exists, merge keeping the most detailed version
							// Prefer PR with diffstat/filesChanged data
							const hasNewDiffstat = pr.diffStat || pr.filesChanged;
							const hasExistingDiffstat = existingPR.diffStat || existingPR.filesChanged;
							
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
									filesChanged: pr.filesChanged || existingPR.filesChanged,
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
				relationships: [{
					...relationship,
					primary: true
				}],
				pullRequests: ticket.pullRequests || [],
				relevanceScore: ticket.relevanceScore || 100
			});
		}
	};
	
	// Process subtasks first (highest priority)
	if (subtasks && Array.isArray(subtasks)) {
		subtasks.forEach(subtask => {
			addTicketWithRelationship(subtask, {
				type: 'subtask',
				direction: 'child',
				depth: 1
			});
		});
		log.info(`Processed ${subtasks.length} subtasks`);
	}
	
	// Process related context tickets
	if (relatedContext && relatedContext.tickets && Array.isArray(relatedContext.tickets)) {
		relatedContext.tickets.forEach(contextItem => {
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
		log.info(`Processed ${relatedContext.tickets.length} related context tickets`);
	}
	
	// Convert map to array and calculate summary
	const relatedTickets = Array.from(ticketMap.values());
	
	// Calculate relationship summary
	const relationshipSummary = {
		subtasks: relatedTickets.filter(t => t.relationships.some(r => r.type === 'subtask')).length,
		dependencies: relatedTickets.filter(t => t.relationships.some(r => r.type === 'dependency')).length,
		relatedTickets: relatedTickets.filter(t => t.relationships.some(r => r.type === 'related')).length,
		totalUnique: relatedTickets.length
	};
	
	// Preserve original context summary if available
	const contextSummary = relatedContext?.summary || {
		overview: `Found ${relationshipSummary.totalUnique} unique related tickets`,
		recentActivity: "No activity information available",
		completedWork: `${relatedTickets.filter(t => t.ticket.status === 'done' || t.ticket.status === 'Done').length} tickets completed`,
		implementationInsights: []
	};
	
	log.info(`Deduplicated to ${relationshipSummary.totalUnique} unique tickets from ${(subtasks?.length || 0) + (relatedContext?.tickets?.length || 0)} total`);
	
	return {
		relatedTickets,
		relationshipSummary,
		contextSummary
	};
}

/**
 * Export the deduplicateTickets function for testing
 */
// export { deduplicateTickets };

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
							await addContextToTask(result.data.task, args.id, args.maxRelatedTickets, args.withSubtasks, log);
						} catch (contextError) {
							// Context failure should not break the main functionality
							log.warn(`Failed to add context to task ${args.id}: ${contextError.message}`);
							// Continue without context
						}
					}

					// Extract context images before formatting response
					let contextImages = [];
					if (result.data.task._contextImages && result.data.task._contextImages.length > 0) {
						contextImages = result.data.task._contextImages;
						// Clean up the temporary context images from the ticket object BEFORE JSON.stringify
						delete result.data.task._contextImages;
					}

					// Rest of existing response formatting logic...
					const content = [];
					content.push({
						type: 'text',
						text: typeof result.data.task === 'object'
							? JSON.stringify(result.data.task, null, 2)
							: String(result.data.task)
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

/**
 * Extract attachment images from context tickets and remove them from the context
 * @param {Object} relatedContext - The related context object containing tickets
 * @param {Object} log - Logger instance
 * @returns {Array} Array of extracted image objects
 */
function extractAndRemoveContextImages(relatedContext, log) {
	const contextImages = [];
	
	if (!relatedContext || !relatedContext.tickets) {
		return contextImages;
	}
	
	// Process each context ticket
	relatedContext.tickets.forEach((contextTicketWrapper, ticketIndex) => {
		// The structure is: contextTicketWrapper.ticket.attachmentImages
		// We need to check and remove from the nested ticket object
		if (contextTicketWrapper.ticket && contextTicketWrapper.ticket.attachmentImages && Array.isArray(contextTicketWrapper.ticket.attachmentImages)) {
			const imageCount = contextTicketWrapper.ticket.attachmentImages.length;
			
			// Extract images and add metadata about source ticket
			contextTicketWrapper.ticket.attachmentImages.forEach((image, imageIndex) => {
				contextImages.push({
					...image,
					sourceTicket: contextTicketWrapper.ticket.key || `context-ticket-${ticketIndex}`,
					sourceTicketSummary: contextTicketWrapper.ticket.summary || 'Unknown',
					contextIndex: ticketIndex,
					imageIndex: imageIndex
				});
			});
			
			// Remove the attachmentImages array from the nested ticket object
			delete contextTicketWrapper.ticket.attachmentImages;
			log.info(`Extracted ${imageCount} images from context ticket ${contextTicketWrapper.ticket.key}`);
		}
		
		// Also check the wrapper level (for backwards compatibility)
		if (contextTicketWrapper.attachmentImages && Array.isArray(contextTicketWrapper.attachmentImages)) {
			const imageCount = contextTicketWrapper.attachmentImages.length;
			
			// Extract images and add metadata about source ticket
			contextTicketWrapper.attachmentImages.forEach((image, imageIndex) => {
				contextImages.push({
					...image,
					sourceTicket: contextTicketWrapper.key || `context-ticket-${ticketIndex}`,
					sourceTicketSummary: contextTicketWrapper.summary || 'Unknown',
					contextIndex: ticketIndex,
					imageIndex: imageIndex
				});
			});
			
			// Remove the attachmentImages array from the wrapper
			delete contextTicketWrapper.attachmentImages;
			log.info(`Extracted ${imageCount} images from context ticket wrapper ${contextTicketWrapper.key}`);
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
export async function addContextToTask(ticket, ticketId, maxRelatedTickets, withSubtasks, log) {
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
		const contextAggregator = new ContextAggregator(relationshipResolver, bitbucketClient, prMatcher);

		log.info(`Fetching context for ticket ${ticketId}...`);

			// Extract repository information from ticket's development info if available
		let detectedRepositories = [];
		
		// Try to get repository info from development status first
		if (contextAggregator.prMatcher) {
			try {
				const devStatusResult = await contextAggregator.prMatcher.getJiraDevStatus(ticketId);
				if (devStatusResult.success && devStatusResult.data) {
					// Extract unique repository names from PRs
					const repoNames = devStatusResult.data
						.filter(pr => pr.repository)
						.map(pr => {
							// Handle both full paths and repo names
							const repo = pr.repository;
							return repo.includes('/') ? repo.split('/')[1] : repo;
						})
						.filter((repo, index, arr) => arr.indexOf(repo) === index); // Remove duplicates
					
					detectedRepositories = repoNames;
					log.info(`Detected repositories from development info: ${detectedRepositories.join(', ')}`);
				}
			} catch (devError) {
				log.warn(`Could not detect repositories from development info: ${devError.message}`);
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
				debug: (msg) => log.debug ? log.debug(msg) : log.info(`[DEBUG] ${msg}`) // Fallback for debug
			}
		});

		// 30-second timeout for context retrieval (matches working test)
		const timeoutPromise = new Promise((_, reject) =>
			setTimeout(() => reject(new Error('Context retrieval timeout')), 30000)
		);

		// CRITICAL FIX: Fetch main ticket PR data BEFORE context aggregation and deduplication
		// This ensures the main ticket's PR data is available during deduplication
		if (!ticket.pullRequests || ticket.pullRequests.length === 0) {
			log.info(`Main ticket ${ticketId} has no PR data, fetching from development status...`);
			
			try {
				// Get PRs for the main ticket from Jira dev status
				const mainTicketPRs = await prMatcher.getJiraDevStatus(ticketId);
				
				if (mainTicketPRs.success && mainTicketPRs.data && mainTicketPRs.data.length > 0) {
					// The PRs are already enhanced by getJiraDevStatus
					ticket.pullRequests = mainTicketPRs.data;
					log.info(`Added ${mainTicketPRs.data.length} PRs to main ticket ${ticketId} BEFORE deduplication`);
					
					// Debug log PR details
					mainTicketPRs.data.forEach(pr => {
						log.info(`Main ticket PR ${pr.id}: has diffStat=${!!pr.diffStat}, has filesChanged=${!!pr.filesChanged}`);
						if (pr.diffStat) {
							log.info(`  - Additions: ${pr.diffStat.additions}, Deletions: ${pr.diffStat.deletions}`);
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
			const contextImages = extractAndRemoveContextImages(context.relatedContext, log);
			
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
				log.info(`Extracted ${contextImages.length} images from context tickets`);
			}
		} else {
			log.info('No context returned or no relatedContext property');
		}

	} catch (error) {
		log.warn(`Context retrieval failed: ${error.message}`);
		// Don't throw - context failure shouldn't break main functionality
	}
}
