/**
 * @fileoverview Jira Relationship Resolver for comprehensive ticket relationship traversal
 * 
 * This module provides functionality to traverse and resolve complex Jira ticket relationships
 * including parent/child, epic/story, dependencies, and various link types. It leverages
 * existing relationship data already fetched by the JiraClient implementation.
 * 
 * @author Task Master AI
 * @version 1.0.0
 */

import { JiraClient } from './jira-client.js';
import { JiraTicket } from './jira-ticket.js';

/**
 * Service for traversing and resolving Jira ticket relationships
 * 
 * Supports multiple relationship types:
 * - Parent/Child hierarchies
 * - Epic/Story relationships  
 * - Issue links (blocks, depends on, relates to, etc.)
 * - Circular relationship detection
 * - Configurable depth limiting
 * - Performance caching
 */
export class JiraRelationshipResolver {
	/**
	 * Initialize the relationship resolver
	 * @param {JiraClient} jiraClient - Configured Jira client instance
	 */
	constructor(jiraClient) {
		this.jiraClient = jiraClient;
		this.cache = new Map();
		this.cacheTimeout = 5 * 60 * 1000; // 5 minutes in milliseconds
		
		// Circuit breaker settings
		this.maxRelatedIssues = 20;
		this.defaultMaxDepth = 2;
	}

	/**
	 * Resolve all relationships for a given issue
	 * @param {string} issueKey - The Jira issue key to start from
	 * @param {Object} options - Configuration options
	 * @param {number} [options.depth=2] - Maximum traversal depth
	 * @param {string[]} [options.includeTypes] - Relationship types to include
	 * @param {Object} [options.log] - Logger object
	 * @returns {Promise<Object>} Relationship graph with metadata
	 */
	async resolveRelationships(issueKey, options = {}) {
		const {
			depth = this.defaultMaxDepth,
			includeTypes = ['parent', 'child', 'epic', 'story', 'dependency', 'relates', 'blocks'],
			log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
		} = options;

		log.info(`Starting relationship resolution for ${issueKey} with depth ${depth}`);

		// Check cache first
		const cacheKey = `${issueKey}-${depth}-${includeTypes.join(',')}`;
		const cached = this.getCachedResult(cacheKey);
		if (cached) {
			log.debug(`Returning cached relationship data for ${issueKey}`);
			return cached;
		}

		try {
			// Fetch the root issue first
			const rootResult = await this.jiraClient.fetchIssue(issueKey, { log });
			if (!rootResult.success) {
				return {
					success: false,
					error: rootResult.error
				};
			}

			const rootIssue = rootResult.data;
			
			// Add debugging to see what the root issue looks like
			log.info(`[RESOLVER DEBUG] Root issue fetched: ${issueKey}`);
			log.info(`[RESOLVER DEBUG] Root issue parentKey: ${rootIssue.parentKey}`);
			log.info(`[RESOLVER DEBUG] Root issue issueType: ${rootIssue.issueType}`);
			log.info(`[RESOLVER DEBUG] Root issue has parentKey: ${!!rootIssue.parentKey}`);
			log.info(`[RESOLVER DEBUG] Include types: ${includeTypes.join(', ')}`);
			log.info(`[RESOLVER DEBUG] Root issue object keys: ${Object.keys(rootIssue).join(', ')}`);
			log.info(`[RESOLVER DEBUG] Root issue full object: ${JSON.stringify(rootIssue, null, 2)}`);
			
			const visited = new Set();
			const relationships = [];

			// Start traversal from root issue
			await this.traverseRelationships(
				rootIssue,
				relationships,
				visited,
				depth,
				includeTypes,
				1, // Start at depth 1, so first level relationships are depth 1
				log
			);

			// Build result object
			const result = {
				success: true,
				data: {
					sourceIssue: issueKey,
					relationships,
					metadata: {
						totalRelated: relationships.length,
						maxDepthReached: Math.max(...relationships.map(r => r.depth), 0),
						relationshipTypes: [...new Set(relationships.map(r => r.relationship))],
						circularReferencesDetected: visited.size > relationships.length + 1
					}
				}
			};

			// Cache the result
			this.setCachedResult(cacheKey, result);

			log.info(`Relationship resolution complete: found ${relationships.length} related issues`);
			return result;

		} catch (error) {
			log.error(`Error resolving relationships for ${issueKey}: ${error.message}`);
			return {
				success: false,
				error: {
					code: 'RELATIONSHIP_RESOLUTION_ERROR',
					message: `Failed to resolve relationships: ${error.message}`
				}
			};
		}
	}

	/**
	 * Check if a relationship already exists in the relationships array
	 * @param {Array} relationships - Array of existing relationships
	 * @param {string} issueKey - Issue key to check
	 * @param {string} relationship - Relationship type
	 * @returns {boolean} True if relationship already exists
	 */
	isRelationshipExists(relationships, issueKey, relationship) {
		return relationships.some(r => r.issueKey === issueKey && r.relationship === relationship);
	}

	/**
	 * Recursively traverse all relationship types for an issue
	 * @param {JiraTicket} issue - Current issue being processed
	 * @param {Array} relationships - Array to collect relationships
	 * @param {Set} visited - Set of visited issue keys to prevent cycles
	 * @param {number} maxDepth - Maximum depth to traverse
	 * @param {string[]} includeTypes - Relationship types to include
	 * @param {number} currentDepth - Current traversal depth
	 * @param {Object} log - Logger object
	 */
	async traverseRelationships(issue, relationships, visited, maxDepth, includeTypes, currentDepth, log) {
		// Circuit breaker - prevent excessive API calls
		if (relationships.length >= this.maxRelatedIssues) {
			log.warn(`Circuit breaker activated: reached maximum of ${this.maxRelatedIssues} related issues`);
			return;
		}

		// Depth limit check
		if (currentDepth > maxDepth) {
			log.debug(`Reached maximum depth ${maxDepth}, stopping traversal`);
			return;
		}

		// Mark as visited to prevent circular references
		visited.add(issue.jiraKey);

		// Traverse issue links (dependencies, blocks, relates to, etc.)
		if (includeTypes.some(type => ['dependency', 'relates', 'blocks'].includes(type))) {
			await this.traverseIssueLinks(issue, relationships, visited, maxDepth, includeTypes, currentDepth, log);
		}

		// Traverse parent/child relationships
		if (includeTypes.some(type => ['parent', 'child'].includes(type))) {
			await this.traverseParentChild(issue, relationships, visited, maxDepth, includeTypes, currentDepth, log);
		}

		// Traverse epic/story relationships
		if (includeTypes.some(type => ['epic', 'story'].includes(type))) {
			await this.traverseEpicRelationships(issue, relationships, visited, maxDepth, includeTypes, currentDepth, log);
		}
	}

	/**
	 * Traverse issue links (dependencies, blocks, relates to, etc.)
	 * @param {JiraTicket} issue - Current issue
	 * @param {Array} relationships - Array to collect relationships
	 * @param {Set} visited - Set of visited issue keys
	 * @param {number} maxDepth - Maximum depth to traverse
	 * @param {string[]} includeTypes - Relationship types to include
	 * @param {number} currentDepth - Current traversal depth
	 * @param {Object} log - Logger object
	 */
	async traverseIssueLinks(issue, relationships, visited, maxDepth, includeTypes, currentDepth, log) {
		// Access the raw Jira response to get issuelinks
		// Note: JiraTicket.fromJiraIssue() processes this data, but we need the raw structure
		const rawIssue = await this.jiraClient.getClient().get(`/rest/api/3/issue/${issue.jiraKey}`, {
			params: {
				fields: 'issuelinks,summary,status,priority,issuetype'
			}
		});

		if (!rawIssue.data?.fields?.issuelinks) {
			return;
		}

		// Process each issue link
		for (const link of rawIssue.data.fields.issuelinks) {
			let relatedIssueKey = null;
			let relationship = null;
			let direction = null;

			// Determine relationship type and direction
			if (link.outwardIssue) {
				relatedIssueKey = link.outwardIssue.key;
				relationship = this.mapLinkTypeToRelationship(link.type?.outward || 'relates');
				direction = 'outward';
			} else if (link.inwardIssue) {
				relatedIssueKey = link.inwardIssue.key;
				relationship = this.mapLinkTypeToRelationship(link.type?.inward || 'relates');
				direction = 'inward';
			}

			// Skip if no related issue or if relationship type not included
			if (!relatedIssueKey || !includeTypes.includes(relationship)) {
				continue;
			}

			// Skip if already visited (circular reference)
			if (visited.has(relatedIssueKey)) {
				log.debug(`Skipping ${relatedIssueKey} - already visited (circular reference)`);
				continue;
			}

			// Fetch the related issue
			const relatedResult = await this.jiraClient.fetchIssue(relatedIssueKey, { log });
			if (!relatedResult.success) {
				log.warn(`Failed to fetch related issue ${relatedIssueKey}`);
				continue;
			}

			// Add to relationships if not already exists
			if (!this.isRelationshipExists(relationships, relatedIssueKey, relationship)) {
				relationships.push({
					issueKey: relatedIssueKey,
					relationship,
					direction,
					issue: relatedResult.data,
					depth: currentDepth, // Use current depth as passed by caller
					linkType: link.type?.name || 'Unknown'
				});

				// Recursively traverse if within depth limit
				if (currentDepth < maxDepth) {
					await this.traverseRelationships(
						relatedResult.data,
						relationships,
						visited,
						maxDepth,
						includeTypes,
						currentDepth + 1,
						log
					);
				}
			}
		}
	}

	/**
	 * Traverse parent/child relationships
	 * @param {JiraTicket} issue - Current issue
	 * @param {Array} relationships - Array to collect relationships
	 * @param {Set} visited - Set of visited issue keys
	 * @param {number} maxDepth - Maximum depth to traverse
	 * @param {string[]} includeTypes - Relationship types to include
	 * @param {number} currentDepth - Current traversal depth
	 * @param {Object} log - Logger object
	 */
	async traverseParentChild(issue, relationships, visited, maxDepth, includeTypes, currentDepth, log) {
		// Traverse parent relationship
		if (includeTypes.includes('parent') && issue.parentKey) {
			if (!visited.has(issue.parentKey) && !this.isRelationshipExists(relationships, issue.parentKey, 'parent')) {
				const parentResult = await this.jiraClient.fetchIssue(issue.parentKey, { log });
				if (parentResult.success) {
					relationships.push({
						issueKey: issue.parentKey,
						relationship: 'parent',
						direction: 'upward',
						issue: parentResult.data,
						depth: currentDepth // Use current depth as passed by caller
					});

					// Recursively traverse parent if within depth limit
					if (currentDepth < maxDepth) {
						await this.traverseRelationships(
							parentResult.data,
							relationships,
							visited,
							maxDepth,
							includeTypes,
							currentDepth + 1,
							log
						);
					}
				}
			}
		}

		// Traverse child relationships (subtasks)
		if (includeTypes.includes('child')) {
			const childrenJql = `project = "${this.jiraClient.config.project}" AND parent = "${issue.jiraKey}"`;
			const childrenResult = await this.jiraClient.searchIssues(childrenJql, { 
				maxResults: 50, 
				log 
			});

			if (childrenResult.success) {
				for (const childIssue of childrenResult.data) {
					if (!visited.has(childIssue.jiraKey) && !this.isRelationshipExists(relationships, childIssue.jiraKey, 'child')) {
						relationships.push({
							issueKey: childIssue.jiraKey,
							relationship: 'child',
							direction: 'downward',
							issue: childIssue,
							depth: currentDepth // Use current depth as passed by caller
						});

						// Recursively traverse children if within depth limit
						if (currentDepth < maxDepth) {
							await this.traverseRelationships(
								childIssue,
								relationships,
								visited,
								maxDepth,
								includeTypes,
								currentDepth + 1,
								log
							);
						}
					}
				}
			}
		}
	}

	/**
	 * Traverse epic/story relationships
	 * @param {JiraTicket} issue - Current issue
	 * @param {Array} relationships - Array to collect relationships
	 * @param {Set} visited - Set of visited issue keys
	 * @param {number} maxDepth - Maximum depth to traverse
	 * @param {string[]} includeTypes - Relationship types to include
	 * @param {number} currentDepth - Current traversal depth
	 * @param {Object} log - Logger object
	 */
	async traverseEpicRelationships(issue, relationships, visited, maxDepth, includeTypes, currentDepth, log) {
		// If current issue is an Epic, find its stories
		if (includeTypes.includes('story') && issue.issueType === 'Epic') {
			const storiesJql = `project = "${this.jiraClient.config.project}" AND "Epic Link" = "${issue.jiraKey}"`;
			const storiesResult = await this.jiraClient.searchIssues(storiesJql, { 
				maxResults: 50, 
				log 
			});

			if (storiesResult.success) {
				for (const storyIssue of storiesResult.data) {
					if (!visited.has(storyIssue.jiraKey) && !this.isRelationshipExists(relationships, storyIssue.jiraKey, 'story')) {
						relationships.push({
							issueKey: storyIssue.jiraKey,
							relationship: 'story',
							direction: 'downward',
							issue: storyIssue,
							depth: currentDepth // Use current depth as passed by caller
						});

						// Recursively traverse stories if within depth limit
						if (currentDepth < maxDepth) {
							await this.traverseRelationships(
								storyIssue,
								relationships,
								visited,
								maxDepth,
								includeTypes,
								currentDepth + 1,
								log
							);
						}
					}
				}
			}
		}

		// If current issue has an Epic Link, find the epic
		if (includeTypes.includes('epic')) {
			// Query for epic link - this requires accessing the raw Jira fields
			const rawIssue = await this.jiraClient.getClient().get(`/rest/api/3/issue/${issue.jiraKey}`, {
				params: {
					fields: 'customfield_10014,summary,status,priority,issuetype' // Epic Link is typically customfield_10014
				}
			});

			const epicLink = rawIssue.data?.fields?.customfield_10014;
			if (epicLink && !visited.has(epicLink) && !this.isRelationshipExists(relationships, epicLink, 'epic')) {
				const epicResult = await this.jiraClient.fetchIssue(epicLink, { log });
				if (epicResult.success) {
					relationships.push({
						issueKey: epicLink,
						relationship: 'epic',
						direction: 'upward',
						issue: epicResult.data,
						depth: currentDepth // Use current depth as passed by caller
					});

					// Recursively traverse epic if within depth limit
					if (currentDepth < maxDepth) {
						await this.traverseRelationships(
							epicResult.data,
							relationships,
							visited,
							maxDepth,
							includeTypes,
							currentDepth + 1,
							log
						);
					}
				}
			}
		}
	}

	/**
	 * Map Jira link types to standardized relationship types
	 * @param {string} linkType - Jira link type
	 * @returns {string} Standardized relationship type
	 */
	mapLinkTypeToRelationship(linkType) {
		const mapping = {
			'blocks': 'blocks',
			'is blocked by': 'blocks',
			'depends on': 'dependency',
			'is depended on by': 'dependency',
			'relates to': 'relates',
			'duplicates': 'relates',
			'is duplicated by': 'relates',
			'clones': 'relates',
			'is cloned by': 'relates'
		};

		return mapping[linkType.toLowerCase()] || 'relates';
	}

	/**
	 * Get cached relationship result
	 * @param {string} cacheKey - Cache key
	 * @returns {Object|null} Cached result or null
	 */
	getCachedResult(cacheKey) {
		const cached = this.cache.get(cacheKey);
		if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
			return cached.data;
		}
		
		// Remove expired cache entry
		if (cached) {
			this.cache.delete(cacheKey);
		}
		
		return null;
	}

	/**
	 * Set cached relationship result
	 * @param {string} cacheKey - Cache key
	 * @param {Object} result - Result to cache
	 */
	setCachedResult(cacheKey, result) {
		this.cache.set(cacheKey, {
			data: result,
			timestamp: Date.now()
		});

		// Clean up old cache entries if cache gets too large
		if (this.cache.size > 100) {
			const oldestKey = this.cache.keys().next().value;
			this.cache.delete(oldestKey);
		}
	}

	/**
	 * Clear all cached results
	 */
	clearCache() {
		this.cache.clear();
	}

	/**
	 * Get cache statistics
	 * @returns {Object} Cache statistics
	 */
	getCacheStats() {
		return {
			size: this.cache.size,
			maxSize: 100,
			timeout: this.cacheTimeout
		};
	}
} 