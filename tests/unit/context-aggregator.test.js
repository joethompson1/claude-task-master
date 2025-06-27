import { jest } from '@jest/globals';
import { ContextAggregator } from '../../mcp-server/src/core/utils/context-aggregator.js';

describe('ContextAggregator', () => {
  let contextAggregator;
  let mockJiraResolver;
  let mockBitbucketClient;
  let mockPRMatcher;

  beforeEach(() => {
    // Mock JiraRelationshipResolver
    mockJiraResolver = {
      resolveRelationships: jest.fn()
    };

    // Mock BitbucketClient
    mockBitbucketClient = {
      fetchPullRequests: jest.fn()
    };

    // Mock PRTicketMatcher
    mockPRMatcher = {
      findPRsForTicket: jest.fn()
    };

    contextAggregator = new ContextAggregator(
      mockJiraResolver,
      mockBitbucketClient,
      mockPRMatcher
    );

    // Clear environment variables for consistent testing
    delete process.env.CONTEXT_MAX_RELATED;
    delete process.env.CONTEXT_MAX_AGE_MONTHS;
    delete process.env.CONTEXT_CACHE_TTL;
    delete process.env.CONTEXT_ENABLE_FALLBACK;
    delete process.env.BITBUCKET_DEFAULT_REPO;
  });

  afterEach(() => {
    jest.clearAllMocks();
    contextAggregator.clearCache();
  });

  describe('Constructor', () => {
    it('should initialize with default configuration', () => {
      expect(contextAggregator.jiraResolver).toBe(mockJiraResolver);
      expect(contextAggregator.bitbucketClient).toBe(mockBitbucketClient);
      expect(contextAggregator.prMatcher).toBe(mockPRMatcher);
      expect(contextAggregator.config.maxRelated).toBe(20);
      expect(contextAggregator.config.maxAgeMonths).toBe(6);
      expect(contextAggregator.config.cacheTTL).toBe(300);
      expect(contextAggregator.config.enableFallback).toBe(true);
    });

    it('should use environment variables when available', () => {
      process.env.CONTEXT_MAX_RELATED = '30';
      process.env.CONTEXT_MAX_AGE_MONTHS = '12';
      process.env.CONTEXT_CACHE_TTL = '600';
      process.env.CONTEXT_ENABLE_FALLBACK = 'false';

      const aggregator = new ContextAggregator(
        mockJiraResolver,
        mockBitbucketClient,
        mockPRMatcher
      );

      expect(aggregator.config.maxRelated).toBe(30);
      expect(aggregator.config.maxAgeMonths).toBe(12);
      expect(aggregator.config.cacheTTL).toBe(600);
      expect(aggregator.config.enableFallback).toBe(false);
    });
  });

  describe('aggregateContext', () => {
    const mockRelationships = {
      sourceIssue: { key: 'JAR-123', title: 'Source ticket' },
      relationships: [
        {
          issueKey: 'JAR-124',
          relationship: 'parent',
          direction: 'inward',
          depth: 1,
          issue: { key: 'JAR-124', title: 'Parent ticket', status: 'Done', updated: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() }
        },
        {
          issueKey: 'JAR-125',
          relationship: 'child',
          direction: 'outward',
          depth: 1,
          issue: { key: 'JAR-125', title: 'Child ticket', status: 'In Progress', updated: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() }
        }
      ],
      metadata: { totalRelated: 2, maxDepthReached: 1 }
    };

    const mockPRs = [
      {
        id: 42,
        title: 'JAR-124: Fix authentication bug',
        status: 'MERGED',
        mergedDate: '2024-01-15T10:30:00Z',
        fileChangeSummary: { added: 2, modified: 3, deleted: 1 }
      }
    ];

    it('should aggregate full context successfully', async () => {
      mockJiraResolver.resolveRelationships.mockResolvedValue(mockRelationships);
      mockPRMatcher.findPRsForTicket
        .mockResolvedValueOnce(mockPRs)
        .mockResolvedValueOnce([]);

      const result = await contextAggregator.aggregateContext('JAR-123');

      expect(result).toHaveProperty('sourceTicket');
      expect(result).toHaveProperty('relatedContext');
      expect(result).toHaveProperty('metadata');
      expect(result.sourceTicket.key).toBe('JAR-123');
      expect(result.relatedContext.tickets).toHaveLength(2);
      expect(result.relatedContext.summary.totalRelated).toBe(2);
      expect(result.metadata.contextGeneratedAt).toBeDefined();
    });

    it('should use cached results when available', async () => {
      mockJiraResolver.resolveRelationships.mockResolvedValue(mockRelationships);
      mockPRMatcher.findPRsForTicket.mockResolvedValue([]);

      // First call
      await contextAggregator.aggregateContext('JAR-123');
      
      // Second call should use cache
      const result = await contextAggregator.aggregateContext('JAR-123');

      expect(mockJiraResolver.resolveRelationships).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
    });

    it('should fallback to Jira-only context when Bitbucket fails', async () => {
      // Make the buildFullContext method fail by making jiraResolver fail first, then succeed in fallback
      mockJiraResolver.resolveRelationships
        .mockRejectedValueOnce(new Error('Bitbucket API error'))
        .mockResolvedValueOnce(mockRelationships);

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const result = await contextAggregator.aggregateContext('JAR-123');

      expect(result.metadata.fallbackMode).toBe(true);
      expect(result.relatedContext.tickets).toHaveLength(2);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Bitbucket unavailable, returning Jira context only')
      );

      consoleSpy.mockRestore();
    });

    it('should handle empty relationships gracefully', async () => {
      mockJiraResolver.resolveRelationships.mockResolvedValue({
        sourceIssue: { key: 'JAR-123' },
        relationships: [],
        metadata: { totalRelated: 0 }
      });

      const result = await contextAggregator.aggregateContext('JAR-123');

      expect(result.relatedContext.tickets).toHaveLength(0);
      expect(result.relatedContext.summary.totalRelated).toBe(0);
      expect(result.relatedContext.contextSummary.overview).toContain('Found 0 related tickets');
    });

    it('should throw error when fallback is disabled', async () => {
      contextAggregator.config.enableFallback = false;
      mockJiraResolver.resolveRelationships.mockRejectedValue(new Error('Jira API error'));

      await expect(contextAggregator.aggregateContext('JAR-123'))
        .rejects.toThrow('Jira API error');
    });
  });

  describe('filterByRecency', () => {
    const oldDate = '2023-01-01T00:00:00Z';
    const recentDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago

    it('should filter tickets by recency', () => {
      const tickets = [
        {
          ticket: { key: 'JAR-124', updated: oldDate },
          pullRequests: []
        },
        {
          ticket: { key: 'JAR-125', updated: recentDate },
          pullRequests: []
        }
      ];

      const filtered = contextAggregator.filterByRecency(tickets, 6);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].ticket.key).toBe('JAR-125');
    });

    it('should include tickets with recent PRs even if ticket is old', () => {
      const tickets = [
        {
          ticket: { key: 'JAR-124', updated: oldDate },
          pullRequests: [
            { id: 1, mergedDate: recentDate }
          ]
        }
      ];

      const filtered = contextAggregator.filterByRecency(tickets, 6);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].ticket.key).toBe('JAR-124');
    });

    it('should filter out tickets with no recent activity', () => {
      const tickets = [
        {
          ticket: { key: 'JAR-124', updated: oldDate },
          pullRequests: [
            { id: 1, mergedDate: oldDate }
          ]
        }
      ];

      const filtered = contextAggregator.filterByRecency(tickets, 6);

      expect(filtered).toHaveLength(0);
    });
  });

  describe('calculateRelevanceScore', () => {
    it('should score parent relationships highest', () => {
      const ticket = { status: 'Done' };
      const prs = [];
      
      const score = contextAggregator.calculateRelevanceScore(ticket, prs, 'parent');
      
      expect(score).toBeGreaterThan(90);
    });

    it('should give bonus for active status', () => {
      const activeTicket = { status: 'In Progress' };
      const doneTicket = { status: 'Done' };
      
      const activeScore = contextAggregator.calculateRelevanceScore(activeTicket, [], 'relates');
      const doneScore = contextAggregator.calculateRelevanceScore(doneTicket, [], 'relates');
      
      expect(activeScore).toBeGreaterThan(doneScore);
    });

    it('should give bonus for merged PRs', () => {
      const ticket = { status: 'To Do' }; // Lower base score to avoid hitting cap
      const prsWithMerged = [
        { status: 'MERGED', fileChangeSummary: { added: 2, modified: 1 } }
      ];
      const prsWithOpen = [
        { status: 'OPEN', fileChangeSummary: { added: 2, modified: 1 } }
      ];
      
      const mergedScore = contextAggregator.calculateRelevanceScore(ticket, prsWithMerged, 'relates');
      const openScore = contextAggregator.calculateRelevanceScore(ticket, prsWithOpen, 'relates');
      
      expect(mergedScore).toBeGreaterThan(openScore);
    });

    it('should give recency bonus for recent PRs', () => {
      const ticket = { status: 'Done' };
      const recentPRs = [
        { 
          status: 'MERGED', 
          mergedDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() // 10 days ago
        }
      ];
      const oldPRs = [
        { 
          status: 'MERGED', 
          mergedDate: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString() // 200 days ago
        }
      ];
      
      const recentScore = contextAggregator.calculateRelevanceScore(ticket, recentPRs, 'relates');
      const oldScore = contextAggregator.calculateRelevanceScore(ticket, oldPRs, 'relates');
      
      expect(recentScore).toBeGreaterThan(oldScore);
    });
  });

  describe('limitContextSize', () => {
    it('should preserve essential relationships', () => {
      const tickets = [
        { relationship: 'parent', relevanceScore: 80, ticket: { key: 'JAR-124' } },
        { relationship: 'child', relevanceScore: 75, ticket: { key: 'JAR-125' } },
        { relationship: 'relates', relevanceScore: 90, ticket: { key: 'JAR-126' } },
        { relationship: 'relates', relevanceScore: 85, ticket: { key: 'JAR-127' } }
      ];

      const limited = contextAggregator.limitContextSize(tickets, 3);

      expect(limited).toHaveLength(3);
      // Should include both essential relationships (parent, child) plus highest scoring non-essential
      const keys = limited.map(t => t.ticket.key);
      expect(keys).toContain('JAR-124'); // parent
      expect(keys).toContain('JAR-125'); // child
      expect(keys).toContain('JAR-126'); // highest scoring relates
    });

    it('should sort by relevance score when under limit', () => {
      const tickets = [
        { relationship: 'relates', relevanceScore: 60, ticket: { key: 'JAR-124' } },
        { relationship: 'relates', relevanceScore: 90, ticket: { key: 'JAR-125' } },
        { relationship: 'relates', relevanceScore: 75, ticket: { key: 'JAR-126' } }
      ];

      const limited = contextAggregator.limitContextSize(tickets, 5);

      expect(limited).toHaveLength(3);
      expect(limited[0].ticket.key).toBe('JAR-125'); // highest score first
      expect(limited[1].ticket.key).toBe('JAR-126');
      expect(limited[2].ticket.key).toBe('JAR-124');
    });
  });

  describe('generateSummary', () => {
    it('should generate accurate summary statistics', () => {
      const tickets = [
        {
          ticket: { status: 'Done' },
          pullRequests: [
            { status: 'MERGED' },
            { status: 'OPEN' }
          ],
          relevanceScore: 80
        },
        {
          ticket: { status: 'In Progress' },
          pullRequests: [
            { status: 'MERGED' }
          ],
          relevanceScore: 90
        }
      ];

      const summary = contextAggregator.generateSummary(tickets, 5);

      expect(summary.totalRelated).toBe(2);
      expect(summary.filteredOut).toBe(3);
      expect(summary.completedWork).toBe(1);
      expect(summary.activeWork).toBe(1);
      expect(summary.totalPRs).toBe(3);
      expect(summary.mergedPRs).toBe(2);
      expect(summary.averageRelevance).toBe(85);
      expect(summary.statusBreakdown).toEqual({
        'Done': 1,
        'In Progress': 1
      });
    });
  });

  describe('generateContextSummary', () => {
    it('should generate meaningful insights', () => {
      const tickets = [
        {
          ticket: { status: 'In Progress' },
          relationship: 'dependency',
          pullRequests: []
        },
        {
          ticket: { status: 'Done' },
          relationship: 'parent',
          pullRequests: [{ status: 'MERGED' }]
        }
      ];

      const summary = {
        totalRelated: 2,
        activeWork: 1,
        completedWork: 1,
        totalPRs: 1,
        mergedPRs: 1
      };

      const contextSummary = contextAggregator.generateContextSummary(tickets, summary);

      expect(contextSummary.overview).toContain('Found 2 related tickets with 1 associated PRs');
      expect(contextSummary.recentActivity).toContain('1 tickets currently in progress');
      expect(contextSummary.completedWork).toContain('1 tickets completed with implementation details');
      expect(contextSummary.implementationInsights).toContain('1 dependency relationships require coordination');
    });
  });

  describe('extractTechnologyPatterns', () => {
    it('should extract technology patterns from PR files', () => {
      const tickets = [
        {
          pullRequests: [
            {
              files: [
                { filename: 'src/component.jsx' },
                { filename: 'src/utils.ts' },
                { filename: 'styles/main.css' }
              ]
            }
          ]
        }
      ];

      const technologies = contextAggregator.extractTechnologyPatterns(tickets);

      expect(technologies).toContain('React');
      expect(technologies).toContain('TypeScript');
      expect(technologies).toContain('CSS');
    });

    it('should handle tickets without files', () => {
      const tickets = [
        { pullRequests: [] },
        { pullRequests: [{ files: undefined }] }
      ];

      const technologies = contextAggregator.extractTechnologyPatterns(tickets);

      expect(technologies).toHaveLength(0);
    });
  });

  describe('Cache Management', () => {
    it('should cache and retrieve data correctly', () => {
      const data = { test: 'data' };
      const key = 'test-key';

      contextAggregator.setCache(key, data);
      const retrieved = contextAggregator.getFromCache(key);

      expect(retrieved).toEqual(data);
    });

    it('should return null for expired cache entries', () => {
      const data = { test: 'data' };
      const key = 'test-key';

      // Set cache with very short TTL
      contextAggregator.config.cacheTTL = 0.001; // 1ms
      contextAggregator.setCache(key, data);

      // Wait for expiry
      return new Promise(resolve => {
        setTimeout(() => {
          const retrieved = contextAggregator.getFromCache(key);
          expect(retrieved).toBeNull();
          resolve();
        }, 10);
      });
    });

    it('should clean up old entries when cache gets too large', async () => {
      // Set a very short TTL to ensure entries expire
      contextAggregator.config.cacheTTL = 0.001; // 1ms
      
      // Fill cache beyond limit
      for (let i = 0; i < 105; i++) {
        contextAggregator.setCache(`key-${i}`, { relatedContext: { summary: { activeWork: 0 } } });
        if (i < 100) {
          // Add a small delay for the first 100 entries to ensure they expire
          await new Promise(resolve => setTimeout(resolve, 2));
        }
      }

      // The cleanup should have been triggered on the 101st entry and removed expired entries
      expect(contextAggregator.cache.size).toBeLessThanOrEqual(100);
    });

    it('should clear all cache entries', () => {
      contextAggregator.setCache('key1', { data: 1 });
      contextAggregator.setCache('key2', { data: 2 });

      contextAggregator.clearCache();

      expect(contextAggregator.cache.size).toBe(0);
    });

    it('should return cache statistics', () => {
      contextAggregator.setCache('key1', { data: 1 });
      
      const stats = contextAggregator.getCacheStats();

      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('valid');
      expect(stats).toHaveProperty('expired');
      expect(stats.total).toBe(1);
      expect(stats.valid).toBe(1);
      expect(stats.expired).toBe(0);
    });
  });

  describe('Utility Methods', () => {
    it('should extract ticket dates correctly', () => {
      const ticket1 = { updated: '2024-01-15T10:30:00Z' };
      const ticket2 = { created: '2024-01-10T10:30:00Z' };
      const ticket3 = { createdDate: '2024-01-05T10:30:00Z' };
      const ticket4 = {};

      expect(contextAggregator.getTicketDate(ticket1)).toEqual(new Date('2024-01-15T10:30:00Z'));
      expect(contextAggregator.getTicketDate(ticket2)).toEqual(new Date('2024-01-10T10:30:00Z'));
      expect(contextAggregator.getTicketDate(ticket3)).toEqual(new Date('2024-01-05T10:30:00Z'));
      expect(contextAggregator.getTicketDate(ticket4)).toBeNull();
    });

    it('should extract PR dates correctly', () => {
      const pr1 = { mergedDate: '2024-01-15T10:30:00Z' };
      const pr2 = { updatedDate: '2024-01-10T10:30:00Z' };
      const pr3 = { createdDate: '2024-01-05T10:30:00Z' };
      const pr4 = {};

      expect(contextAggregator.getPRDate(pr1)).toEqual(new Date('2024-01-15T10:30:00Z'));
      expect(contextAggregator.getPRDate(pr2)).toEqual(new Date('2024-01-10T10:30:00Z'));
      expect(contextAggregator.getPRDate(pr3)).toEqual(new Date('2024-01-05T10:30:00Z'));
      expect(contextAggregator.getPRDate(pr4)).toBeNull();
    });

    it('should create empty context correctly', () => {
      const emptyContext = contextAggregator.createEmptyContext('JAR-123');

      expect(emptyContext.sourceTicket.key).toBe('JAR-123');
      expect(emptyContext.relatedContext.tickets).toHaveLength(0);
      expect(emptyContext.relatedContext.summary.totalRelated).toBe(0);
      expect(emptyContext.metadata.contextGeneratedAt).toBeDefined();
    });

    it('should generate cache keys correctly', () => {
      const key1 = contextAggregator.generateCacheKey('JAR-123', 'repo1', { depth: 2 });
      const key2 = contextAggregator.generateCacheKey('JAR-123', 'repo2', { depth: 2 });
      const key3 = contextAggregator.generateCacheKey('JAR-123', 'repo1', { depth: 3 });

      expect(key1).not.toBe(key2); // Different repos
      expect(key1).not.toBe(key3); // Different options
      expect(key1).toContain('JAR-123');
      expect(key1).toContain('repo1');
    });

    it('should create error responses correctly', () => {
      const error = contextAggregator.createErrorResponse('TEST_ERROR', 'Test message', { detail: 'extra' });

      expect(error.success).toBe(false);
      expect(error.error.code).toBe('TEST_ERROR');
      expect(error.error.message).toBe('Test message');
      expect(error.error.details).toEqual({ detail: 'extra' });
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complex relationship graph with mixed PR data', async () => {
      const complexRelationships = {
        sourceIssue: { key: 'JAR-123', title: 'Main ticket' },
        relationships: [
                  {
          issueKey: 'JAR-124',
          relationship: 'parent',
          direction: 'inward',
          depth: 1,
          issue: { key: 'JAR-124', title: 'Parent', status: 'Done', updated: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() }
        },
        {
          issueKey: 'JAR-125',
          relationship: 'child',
          direction: 'outward', 
          depth: 1,
          issue: { key: 'JAR-125', title: 'Child', status: 'In Progress', updated: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() }
        },
        {
          issueKey: 'JAR-126',
          relationship: 'relates',
          direction: 'outward',
          depth: 2,
          issue: { key: 'JAR-126', title: 'Related', status: 'To Do', updated: '2023-06-01T00:00:00Z' }
        }
        ],
        metadata: { totalRelated: 3, maxDepthReached: 2 }
      };

      mockJiraResolver.resolveRelationships.mockResolvedValue(complexRelationships);
      mockPRMatcher.findPRsForTicket
        .mockResolvedValueOnce([
          { id: 1, status: 'MERGED', mergedDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString() }
        ])
        .mockResolvedValueOnce([
          { id: 2, status: 'OPEN', createdDate: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString() }
        ])
        .mockResolvedValueOnce([]); // Old ticket with no PRs

      const result = await contextAggregator.aggregateContext('JAR-123', { maxAge: 6 });

      expect(result.relatedContext.tickets).toHaveLength(2); // Should filter out old ticket
      expect(result.relatedContext.summary.totalPRs).toBe(2);
      expect(result.relatedContext.summary.filteredOut).toBe(1);
      expect(result.metadata.filteringApplied).toBe(true);
    });

    it('should handle large context and apply size limiting', async () => {
      // Create many relationships
      const manyRelationships = {
        sourceIssue: { key: 'JAR-123' },
        relationships: Array.from({ length: 30 }, (_, i) => ({
          issueKey: `JAR-${124 + i}`,
          relationship: 'relates',
          direction: 'outward',
          depth: 1,
          issue: { 
            key: `JAR-${124 + i}`, 
            title: `Ticket ${i}`, 
            status: 'Done',
            updated: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
          }
        })),
        metadata: { totalRelated: 30 }
      };

      mockJiraResolver.resolveRelationships.mockResolvedValue(manyRelationships);
      mockPRMatcher.findPRsForTicket.mockResolvedValue([]);

      const result = await contextAggregator.aggregateContext('JAR-123', { maxRelated: 15 });

      expect(result.relatedContext.tickets).toHaveLength(15);
      expect(result.relatedContext.summary.filteredOut).toBe(15);
      expect(result.metadata.filteringApplied).toBe(true);
    });
  });
}); 