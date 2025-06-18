import { jest } from "@jest/globals";
import { PRTicketMatcher } from '../../mcp-server/src/core/utils/pr-ticket-matcher.js';

describe('PRTicketMatcher', () => {
  let prTicketMatcher;
  let mockBitbucketClient;
  let mockJiraClient;

  beforeEach(() => {
    // Mock BitbucketClient
    mockBitbucketClient = {
      config: { workspace: 'test-workspace' },
      fetchPullRequests: jest.fn(),
      fetchPRCommits: jest.fn()
    };

    // Mock JiraClient
    mockJiraClient = {
      fetchRemoteLinks: jest.fn()
    };

    prTicketMatcher = new PRTicketMatcher(mockBitbucketClient, mockJiraClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('should initialize with clients and cache', () => {
      expect(prTicketMatcher.bitbucketClient).toBe(mockBitbucketClient);
      expect(prTicketMatcher.jiraClient).toBe(mockJiraClient);
      expect(prTicketMatcher.cache).toBeInstanceOf(Map);
      expect(prTicketMatcher.cacheTimeout).toBe(10 * 60 * 1000);
    });
  });

  describe('analyzeBranchName', () => {
    test('should return high confidence for exact branch patterns', () => {
      expect(prTicketMatcher.analyzeBranchName('feature/JAR-123-new-feature', 'JAR-123')).toBe(90);
      expect(prTicketMatcher.analyzeBranchName('bugfix/JAR-456-fix-bug', 'JAR-456')).toBe(90);
      expect(prTicketMatcher.analyzeBranchName('hotfix/JAR-789-urgent', 'JAR-789')).toBe(90);
      expect(prTicketMatcher.analyzeBranchName('JAR-123-feature-description', 'JAR-123')).toBe(90);
    });

    test('should return medium confidence for ticket anywhere in branch', () => {
      expect(prTicketMatcher.analyzeBranchName('develop-JAR-123-test', 'JAR-123')).toBe(70);
      expect(prTicketMatcher.analyzeBranchName('some-prefix/JAR-456-description', 'JAR-456')).toBe(90);
    });

    test('should return 0 for no match', () => {
      expect(prTicketMatcher.analyzeBranchName('feature/other-branch', 'JAR-123')).toBe(0);
      expect(prTicketMatcher.analyzeBranchName('', 'JAR-123')).toBe(0);
      expect(prTicketMatcher.analyzeBranchName('feature/JAR-123', '')).toBe(0);
    });

    test('should be case insensitive', () => {
      expect(prTicketMatcher.analyzeBranchName('feature/jar-123-test', 'JAR-123')).toBe(90);
      expect(prTicketMatcher.analyzeBranchName('FEATURE/JAR-123-TEST', 'jar-123')).toBe(90);
    });
  });

  describe('analyzeText', () => {
    test('should return high confidence for structured patterns', () => {
      expect(prTicketMatcher.analyzeText('JAR-123: Fix bug', 'JAR-123')).toBe(75);
      expect(prTicketMatcher.analyzeText('JAR-456 - Implement feature', 'JAR-456')).toBe(75);
      expect(prTicketMatcher.analyzeText('[JAR-789] Update documentation', 'JAR-789')).toBe(75);
      expect(prTicketMatcher.analyzeText('JAR-123 | Add new feature', 'JAR-123')).toBe(75);
    });

    test('should return medium confidence for partial matches', () => {
      expect(prTicketMatcher.analyzeText('Working on JAR-123 today', 'JAR-123')).toBe(50);
      expect(prTicketMatcher.analyzeText('JAR-456 needs attention', 'JAR-456')).toBe(50);
    });

    test('should return 0 for no match', () => {
      expect(prTicketMatcher.analyzeText('Fix some bug', 'JAR-123')).toBe(0);
      expect(prTicketMatcher.analyzeText('', 'JAR-123')).toBe(0);
      expect(prTicketMatcher.analyzeText('JAR-123: Fix bug', '')).toBe(0);
    });

    test('should be case insensitive', () => {
      expect(prTicketMatcher.analyzeText('jar-123: fix bug', 'JAR-123')).toBe(75);
      expect(prTicketMatcher.analyzeText('JAR-123: FIX BUG', 'jar-123')).toBe(75);
    });
  });

  describe('extractTicketsFromText', () => {
    test('should extract tickets from various patterns', () => {
      expect(prTicketMatcher.extractTicketsFromText('JAR-123: Fix bug')).toEqual(['JAR-123']);
      expect(prTicketMatcher.extractTicketsFromText('JAR-456 - Implement feature')).toEqual(['JAR-456']);
      expect(prTicketMatcher.extractTicketsFromText('[JAR-789] Update docs')).toEqual(['JAR-789']);
      expect(prTicketMatcher.extractTicketsFromText('JAR-123 | Add feature')).toEqual(['JAR-123']);
    });

    test('should extract multiple tickets', () => {
      const text = 'JAR-123: Fix bug, also relates to JAR-456 and [JAR-789]';
      const tickets = prTicketMatcher.extractTicketsFromText(text);
      expect(tickets).toContain('JAR-123');
      expect(tickets).toContain('JAR-456');
      expect(tickets).toContain('JAR-789');
      expect(tickets).toHaveLength(3);
    });

    test('should return empty array for no matches', () => {
      expect(prTicketMatcher.extractTicketsFromText('No tickets here')).toEqual([]);
      expect(prTicketMatcher.extractTicketsFromText('')).toEqual([]);
    });

    test('should deduplicate tickets', () => {
      const text = 'JAR-123: Fix bug, JAR-123 needs attention';
      expect(prTicketMatcher.extractTicketsFromText(text)).toEqual(['JAR-123']);
    });
  });

  describe('extractTicketsFromBranch', () => {
    test('should extract tickets from branch patterns', () => {
      expect(prTicketMatcher.extractTicketsFromBranch('feature/JAR-123-new-feature')).toEqual(['JAR-123']);
      expect(prTicketMatcher.extractTicketsFromBranch('bugfix/JAR-456-fix')).toEqual(['JAR-456']);
      expect(prTicketMatcher.extractTicketsFromBranch('JAR-789-description')).toEqual(['JAR-789']);
    });

    test('should return empty array for no matches', () => {
      expect(prTicketMatcher.extractTicketsFromBranch('feature/no-ticket')).toEqual([]);
      expect(prTicketMatcher.extractTicketsFromBranch('')).toEqual([]);
    });
  });

  describe('checkJiraRemoteLinks', () => {
    test('should return Bitbucket PRs from remote links', async () => {
      const remoteLinks = [
        {
          object: {
            url: 'https://bitbucket.org/workspace/repo/pull-requests/42',
            title: 'PR #42: Fix bug'
          }
        },
        {
          object: {
            url: 'https://github.com/user/repo/pull/123',
            title: 'GitHub PR'
          }
        }
      ];

      mockJiraClient.fetchRemoteLinks.mockResolvedValue({
        success: true,
        data: remoteLinks
      });

      const result = await prTicketMatcher.checkJiraRemoteLinks('JAR-123');
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        id: 42,
        title: 'PR #42: Fix bug',
        confidence: 95,
        matchSources: ['jira-link']
      });
    });

    test('should return empty array when no remote links', async () => {
      mockJiraClient.fetchRemoteLinks.mockResolvedValue({
        success: true,
        data: []
      });

      const result = await prTicketMatcher.checkJiraRemoteLinks('JAR-123');
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    test('should handle remote links fetch failure gracefully', async () => {
      mockJiraClient.fetchRemoteLinks.mockResolvedValue({
        success: false,
        error: 'API Error'
      });

      const result = await prTicketMatcher.checkJiraRemoteLinks('JAR-123');
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  describe('cache management', () => {
    test('should cache and retrieve data correctly', () => {
      const testData = { test: 'data' };
      const key = 'test-key';

      prTicketMatcher.setCache(key, testData);
      const retrieved = prTicketMatcher.getFromCache(key);
      
      expect(retrieved).toEqual(testData);
    });

    test('should return null for expired cache', () => {
      const testData = { test: 'data' };
      const key = 'test-key';

      prTicketMatcher.setCache(key, testData);
      
      // Manually expire the cache
      const cached = prTicketMatcher.cache.get(key);
      cached.timestamp = Date.now() - (11 * 60 * 1000); // 11 minutes ago
      
      const retrieved = prTicketMatcher.getFromCache(key);
      expect(retrieved).toBeNull();
    });

    test('should clear all cache', () => {
      prTicketMatcher.setCache('key1', { data: 1 });
      prTicketMatcher.setCache('key2', { data: 2 });
      
      expect(prTicketMatcher.cache.size).toBe(2);
      
      prTicketMatcher.clearCache();
      
      expect(prTicketMatcher.cache.size).toBe(0);
    });
  });
});
