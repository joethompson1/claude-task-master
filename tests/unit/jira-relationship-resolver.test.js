/**
 * @fileoverview Unit tests for JiraRelationshipResolver
 * 
 * Tests comprehensive relationship traversal functionality including:
 * - Parent/Child hierarchies
 * - Epic/Story relationships
 * - Issue links (dependencies, blocks, relates to)
 * - Circular reference detection
 * - Depth limiting
 * - Performance caching
 * - Error handling
 */

import { jest } from '@jest/globals';
import { JiraRelationshipResolver } from '../../mcp-server/src/core/utils/jira-relationship-resolver.js';
import { JiraTicket } from '../../mcp-server/src/core/utils/jira-ticket.js';

// Mock the dependencies
jest.mock('../../mcp-server/src/core/utils/jira-client.js');
jest.mock('../../mcp-server/src/core/utils/jira-ticket.js');

describe('JiraRelationshipResolver', () => {
	let mockJiraClient;
	let resolver;
	let mockLogger;

	beforeEach(() => {
		// Reset all mocks
		jest.clearAllMocks();

		// Create mock Jira client
		mockJiraClient = {
			config: { project: 'TEST' },
			fetchIssue: jest.fn(),
			searchIssues: jest.fn(),
			getClient: jest.fn()
		};

		// Create resolver instance
		resolver = new JiraRelationshipResolver(mockJiraClient);

		// Mock logger
		mockLogger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn()
		};

		// Mock getClient for traverse methods that need raw Jira data
		mockJiraClient.getClient.mockReturnValue({
			get: jest.fn().mockResolvedValue({
				data: {
					fields: {
						issuelinks: [] // No links for basic tests
					}
				}
			})
		});

		// Mock searchIssues for parent/child traversal
		mockJiraClient.searchIssues.mockResolvedValue({
			success: true,
			data: [] // No children for basic tests
		});
	});

	describe('Constructor', () => {
		it('should initialize with default settings', () => {
			expect(resolver.jiraClient).toBe(mockJiraClient);
			expect(resolver.cache).toBeInstanceOf(Map);
			expect(resolver.cacheTimeout).toBe(5 * 60 * 1000); // 5 minutes
			expect(resolver.maxRelatedIssues).toBe(20);
			expect(resolver.defaultMaxDepth).toBe(2);
		});
	});

	describe('resolveRelationships', () => {
		const mockRootIssue = {
			jiraKey: 'TEST-100',
			title: 'Root Issue',
			issueType: 'Epic',
			parentKey: null
		};

		beforeEach(() => {
			mockJiraClient.fetchIssue.mockResolvedValue({
				success: true,
				data: mockRootIssue
			});
		});

		it('should resolve relationships with default options', async () => {
			const result = await resolver.resolveRelationships('TEST-100', { log: mockLogger });

			expect(result.success).toBe(true);
			expect(result.data.sourceIssue).toBe('TEST-100');
			expect(result.data.relationships).toEqual([]);
			expect(result.data.metadata).toMatchObject({
				totalRelated: 0,
				maxDepthReached: 0,
				relationshipTypes: [],
				circularReferencesDetected: false
			});
		});

		it('should handle fetch issue failure', async () => {
			mockJiraClient.fetchIssue.mockResolvedValue({
				success: false,
				error: { code: 'NOT_FOUND', message: 'Issue not found' }
			});

			const result = await resolver.resolveRelationships('TEST-999', { log: mockLogger });

			expect(result.success).toBe(false);
			expect(result.error).toEqual({ code: 'NOT_FOUND', message: 'Issue not found' });
		});

		it('should use cached results when available', async () => {
			// First call
			await resolver.resolveRelationships('TEST-100', { log: mockLogger });
			
			// Second call should use cache
			const result = await resolver.resolveRelationships('TEST-100', { log: mockLogger });

			expect(mockJiraClient.fetchIssue).toHaveBeenCalledTimes(1);
			expect(result.success).toBe(true);
		});

		it('should handle exceptions gracefully', async () => {
			mockJiraClient.fetchIssue.mockRejectedValue(new Error('Network error'));

			const result = await resolver.resolveRelationships('TEST-100', { log: mockLogger });

			expect(result.success).toBe(false);
			expect(result.error.code).toBe('RELATIONSHIP_RESOLUTION_ERROR');
			expect(result.error.message).toContain('Network error');
		});
	});

	describe('traverseIssueLinks', () => {
		const mockIssue = {
			jiraKey: 'TEST-100',
			title: 'Test Issue'
		};

		beforeEach(() => {
			// Mock the axios client response for raw Jira data
			mockJiraClient.getClient.mockReturnValue({
				get: jest.fn().mockImplementation((url) => {
					// Extract issue key from URL
					const issueKeyMatch = url.match(/\/issue\/([^\/\?]+)/);
					const issueKey = issueKeyMatch ? issueKeyMatch[1] : '';
					
					// Return different issuelinks based on the issue key
					if (issueKey === 'TEST-100') {
						return Promise.resolve({
							data: {
								fields: {
									issuelinks: [
										{
											type: { name: 'Blocks', outward: 'blocks', inward: 'is blocked by' },
											outwardIssue: { key: 'TEST-101' }
										},
										{
											type: { name: 'Dependency', outward: 'depends on', inward: 'is depended on by' },
											inwardIssue: { key: 'TEST-102' }
										}
									]
								}
							}
						});
					} else {
						// Other issues have no links to prevent recursive issues
						return Promise.resolve({
							data: {
								fields: {
									issuelinks: []
								}
							}
						});
					}
				})
			});

			mockJiraClient.fetchIssue.mockImplementation((key) => {
				const mockData = {
					'TEST-100': mockIssue,
					'TEST-101': { jiraKey: 'TEST-101', title: 'Blocked Issue' },
					'TEST-102': { jiraKey: 'TEST-102', title: 'Dependency Issue' }
				};
				return Promise.resolve({
					success: true,
					data: mockData[key] || { jiraKey: key, title: `Mock ${key}` }
				});
			});
		});

		it('should traverse outward and inward issue links', async () => {
			const relationships = [];
			const visited = new Set();
			const includeTypes = ['blocks', 'dependency'];

			await resolver.traverseIssueLinks(
				mockIssue,
				relationships,
				visited,
				2, // maxDepth
				includeTypes,
				1, // currentDepth
				mockLogger
			);

			expect(relationships).toHaveLength(2);
			
			// Check outward link (blocks)
			const blocksRelation = relationships.find(r => r.issueKey === 'TEST-101');
			expect(blocksRelation).toMatchObject({
				issueKey: 'TEST-101',
				relationship: 'blocks',
				direction: 'outward',
				depth: 1,
				linkType: 'Blocks'
			});

			// Check inward link (dependency)
			const depRelation = relationships.find(r => r.issueKey === 'TEST-102');
			expect(depRelation).toMatchObject({
				issueKey: 'TEST-102',
				relationship: 'dependency',
				direction: 'inward',
				depth: 1,
				linkType: 'Dependency'
			});
		});

		it('should skip circular references', async () => {
			const relationships = [];
			const visited = new Set(['TEST-101']); // Mark as already visited
			const includeTypes = ['blocks', 'dependency'];

			await resolver.traverseIssueLinks(
				mockIssue,
				relationships,
				visited,
				2,
				includeTypes,
				1,
				mockLogger
			);

			// Should only find TEST-102, not TEST-101 (circular)
			expect(relationships).toHaveLength(1);
			expect(relationships[0].issueKey).toBe('TEST-102');
		});

		it('should filter by included relationship types', async () => {
			const relationships = [];
			const visited = new Set();
			const includeTypes = ['blocks']; // Only include blocks, not dependency

			await resolver.traverseIssueLinks(
				mockIssue,
				relationships,
				visited,
				2,
				includeTypes,
				1,
				mockLogger
			);

			expect(relationships).toHaveLength(1);
			expect(relationships[0].relationship).toBe('blocks');
		});
	});

	describe('traverseParentChild', () => {
		const mockIssueWithParent = {
			jiraKey: 'TEST-200',
			title: 'Child Issue',
			parentKey: 'TEST-100'
		};

		const mockParentIssue = {
			jiraKey: 'TEST-100',
			title: 'Parent Issue'
		};

		const mockChildIssues = [
			{ jiraKey: 'TEST-201', title: 'Child 1', parentKey: 'TEST-100' },
			{ jiraKey: 'TEST-202', title: 'Child 2', parentKey: 'TEST-100' }
		];

		beforeEach(() => {
			mockJiraClient.fetchIssue.mockImplementation((key) => {
				if (key === 'TEST-100') {
					return Promise.resolve({ success: true, data: mockParentIssue });
				}
				// Return child issues with proper parent keys
				const childData = mockChildIssues.find(child => child.jiraKey === key);
				if (childData) {
					return Promise.resolve({ success: true, data: childData });
				}
				return Promise.resolve({
					success: true,
					data: { jiraKey: key, title: `Mock ${key}` }
				});
			});

			mockJiraClient.searchIssues.mockImplementation((jql) => {
				// Return children for TEST-100 parent query
				if (jql.includes('parent = "TEST-100"')) {
					return Promise.resolve({
						success: true,
						data: mockChildIssues
					});
				}
				// Return empty results for other queries (like children of child issues)
				return Promise.resolve({
					success: true,
					data: []
				});
			});
		});

		it('should traverse parent relationships', async () => {
			const relationships = [];
			const visited = new Set();
			const includeTypes = ['parent'];

			await resolver.traverseParentChild(
				mockIssueWithParent,
				relationships,
				visited,
				2,
				includeTypes,
				1,
				mockLogger
			);

			expect(relationships).toHaveLength(1);
			expect(relationships[0]).toMatchObject({
				issueKey: 'TEST-100',
				relationship: 'parent',
				direction: 'upward',
				depth: 1
			});
		});

		it('should traverse child relationships', async () => {
			const relationships = [];
			const visited = new Set();
			const includeTypes = ['child'];

			await resolver.traverseParentChild(
				mockParentIssue,
				relationships,
				visited,
				2,
				includeTypes,
				1,
				mockLogger
			);

			expect(relationships).toHaveLength(2);
			expect(relationships[0]).toMatchObject({
				issueKey: 'TEST-201',
				relationship: 'child',
				direction: 'downward',
				depth: 1
			});
			expect(relationships[1]).toMatchObject({
				issueKey: 'TEST-202',
				relationship: 'child',
				direction: 'downward',
				depth: 1
			});
		});

		it('should skip parent if already visited', async () => {
			const relationships = [];
			const visited = new Set(['TEST-100']); // Parent already visited
			const includeTypes = ['parent'];

			await resolver.traverseParentChild(
				mockIssueWithParent,
				relationships,
				visited,
				2,
				includeTypes,
				1,
				mockLogger
			);

			expect(relationships).toHaveLength(0);
		});
	});

	describe('traverseEpicRelationships', () => {
		const mockEpicIssue = {
			jiraKey: 'TEST-300',
			title: 'Epic Issue',
			issueType: 'Epic'
		};

		const mockStoryIssues = [
			{ jiraKey: 'TEST-301', title: 'Story 1' },
			{ jiraKey: 'TEST-302', title: 'Story 2' }
		];

		beforeEach(() => {
			mockJiraClient.searchIssues.mockResolvedValue({
				success: true,
				data: mockStoryIssues
			});

			mockJiraClient.getClient.mockReturnValue({
				get: jest.fn().mockResolvedValue({
					data: {
						fields: {
							customfield_10014: 'TEST-300' // Epic Link
						}
					}
				})
			});

			mockJiraClient.fetchIssue.mockResolvedValue({
				success: true,
				data: mockEpicIssue
			});
		});

		it('should find stories for an epic', async () => {
			const relationships = [];
			const visited = new Set();
			const includeTypes = ['story'];

			await resolver.traverseEpicRelationships(
				mockEpicIssue,
				relationships,
				visited,
				2,
				includeTypes,
				1,
				mockLogger
			);

			expect(relationships).toHaveLength(2);
			expect(relationships[0]).toMatchObject({
				issueKey: 'TEST-301',
				relationship: 'story',
				direction: 'downward',
				depth: 1
			});
		});

		it('should find epic for a story', async () => {
			const storyIssue = { jiraKey: 'TEST-301', title: 'Story Issue' };
			const relationships = [];
			const visited = new Set();
			const includeTypes = ['epic'];

			await resolver.traverseEpicRelationships(
				storyIssue,
				relationships,
				visited,
				2,
				includeTypes,
				1,
				mockLogger
			);

			expect(relationships).toHaveLength(1);
			expect(relationships[0]).toMatchObject({
				issueKey: 'TEST-300',
				relationship: 'epic',
				direction: 'upward',
				depth: 1
			});
		});
	});

	describe('mapLinkTypeToRelationship', () => {
		it('should map standard link types correctly', () => {
			expect(resolver.mapLinkTypeToRelationship('blocks')).toBe('blocks');
			expect(resolver.mapLinkTypeToRelationship('is blocked by')).toBe('blocks');
			expect(resolver.mapLinkTypeToRelationship('depends on')).toBe('dependency');
			expect(resolver.mapLinkTypeToRelationship('is depended on by')).toBe('dependency');
			expect(resolver.mapLinkTypeToRelationship('relates to')).toBe('relates');
			expect(resolver.mapLinkTypeToRelationship('duplicates')).toBe('relates');
		});

		it('should handle unknown link types', () => {
			expect(resolver.mapLinkTypeToRelationship('unknown type')).toBe('relates');
		});

		it('should be case insensitive', () => {
			expect(resolver.mapLinkTypeToRelationship('BLOCKS')).toBe('blocks');
			expect(resolver.mapLinkTypeToRelationship('Depends On')).toBe('dependency');
		});
	});

	describe('Cache Management', () => {
		it('should cache and retrieve results', () => {
			const testResult = { success: true, data: { test: 'data' } };
			const cacheKey = 'test-key';

			resolver.setCachedResult(cacheKey, testResult);
			const retrieved = resolver.getCachedResult(cacheKey);

			expect(retrieved).toEqual(testResult);
		});

		it('should return null for expired cache entries', () => {
			const testResult = { success: true, data: { test: 'data' } };
			const cacheKey = 'test-key';

			// Set a very short timeout for testing
			resolver.cacheTimeout = 1; // 1ms
			resolver.setCachedResult(cacheKey, testResult);

			// Wait for expiration
			return new Promise(resolve => {
				setTimeout(() => {
					const retrieved = resolver.getCachedResult(cacheKey);
					expect(retrieved).toBeNull();
					resolve();
				}, 10);
			});
		});

		it('should clean up old entries when cache gets too large', () => {
			// Fill cache beyond limit
			for (let i = 0; i < 105; i++) {
				resolver.setCachedResult(`key-${i}`, { data: i });
			}

			expect(resolver.cache.size).toBeLessThanOrEqual(100);
		});

		it('should clear all cache entries', () => {
			resolver.setCachedResult('key1', { data: 1 });
			resolver.setCachedResult('key2', { data: 2 });

			expect(resolver.cache.size).toBe(2);

			resolver.clearCache();

			expect(resolver.cache.size).toBe(0);
		});

		it('should return cache statistics', () => {
			resolver.setCachedResult('key1', { data: 1 });
			resolver.setCachedResult('key2', { data: 2 });

			const stats = resolver.getCacheStats();

			expect(stats).toEqual({
				size: 2,
				maxSize: 100,
				timeout: resolver.cacheTimeout
			});
		});
	});

	describe('Circuit Breaker', () => {
		it('should stop traversal when max related issues reached', async () => {
			const mockIssue = { jiraKey: 'TEST-400', title: 'Test Issue' };
			const relationships = new Array(20).fill(null).map((_, i) => ({
				issueKey: `TEST-${400 + i}`,
				relationship: 'relates'
			}));
			const visited = new Set();

			// Should not add more relationships due to circuit breaker
			await resolver.traverseRelationships(
				mockIssue,
				relationships,
				visited,
				5, // maxDepth
				['relates'],
				1, // currentDepth
				mockLogger
			);

			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('Circuit breaker activated')
			);
		});
	});

	describe('Depth Limiting', () => {
		it('should stop traversal at maximum depth', async () => {
			const mockIssue = { jiraKey: 'TEST-500', title: 'Test Issue' };
			const relationships = [];
			const visited = new Set();

			await resolver.traverseRelationships(
				mockIssue,
				relationships,
				visited,
				1, // maxDepth = 1
				['relates'],
				2, // currentDepth = 2 (exceeds max)
				mockLogger
			);

			expect(mockLogger.debug).toHaveBeenCalledWith(
				expect.stringContaining('Reached maximum depth')
			);
		});
	});

	describe('Integration with JiraTicket', () => {
		it('should work with JiraTicket instances', async () => {
			const mockTicket = new JiraTicket({
				jiraKey: 'TEST-600',
				title: 'Integration Test',
				relatedContext: null
			});

			mockJiraClient.fetchIssue.mockResolvedValue({
				success: true,
				data: mockTicket
			});

			const result = await resolver.resolveRelationships('TEST-600', { log: mockLogger });

			expect(result.success).toBe(true);
			expect(result.data.sourceIssue).toBe('TEST-600');
		});
	});
}); 