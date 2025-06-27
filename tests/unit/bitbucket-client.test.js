import { BitbucketClient } from '../../mcp-server/src/core/utils/bitbucket-client.js';
import { jest } from '@jest/globals';

// Mock axios
jest.mock('axios');
import axios from 'axios';

describe('BitbucketClient', () => {
  const originalEnv = process.env;
  let mockAxiosInstance;

  beforeEach(() => {
    // Reset environment
    jest.resetModules();
    process.env = { ...originalEnv };
    
    // Mock axios create
    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn()
    };
    axios.create = jest.fn().mockReturnValue(mockAxiosInstance);
    
    // Set up test environment variables
    process.env.BITBUCKET_WORKSPACE = 'test-workspace';
    process.env.BITBUCKET_USERNAME = 'test-user';
    process.env.BITBUCKET_API_TOKEN = 'test-api-token';
    process.env.BITBUCKET_DEFAULT_REPO = 'test-repo';
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  describe('Configuration', () => {
    test('getBitbucketConfig returns environment variables', () => {
      const config = BitbucketClient.getBitbucketConfig();
      
      expect(config).toEqual({
        workspace: 'test-workspace',
        username: 'test-user',
        apiToken: 'test-api-token',
        defaultRepo: 'test-repo'
      });
    });

    test('isBitbucketEnabled returns true when all required vars are set', () => {
      expect(BitbucketClient.isBitbucketEnabled()).toBe(true);
    });

    test('isBitbucketEnabled returns false when required vars are missing', () => {
      delete process.env.BITBUCKET_WORKSPACE;
      expect(BitbucketClient.isBitbucketEnabled()).toBe(false);
    });

    test('initializes with environment variables', () => {
      const client = new BitbucketClient();
      
      expect(client.config.workspace).toBe('test-workspace');
      expect(client.config.username).toBe('test-user');
      expect(client.enabled).toBe(true);
      expect(client.isReady()).toBe(true);
    });

    test('handles missing environment variables', () => {
      delete process.env.BITBUCKET_WORKSPACE;
      delete process.env.BITBUCKET_USERNAME;
      delete process.env.BITBUCKET_API_TOKEN;
      
      const client = new BitbucketClient();
      
      expect(client.enabled).toBe(false);
      expect(client.isReady()).toBe(false);
      expect(client.client).toBe(null);
    });

    test('handles client initialization errors', () => {
      axios.create.mockImplementation(() => {
        throw new Error('Axios initialization failed');
      });
      
      const client = new BitbucketClient();
      
      expect(client.enabled).toBe(true);
      expect(client.client).toBe(null);
      expect(client.error).toBe('Axios initialization failed');
      expect(client.isReady()).toBe(false);
    });
  });

  describe('Client Creation', () => {
    test('createClient configures axios correctly', () => {
      const client = new BitbucketClient();
      
      expect(axios.create).toHaveBeenCalledWith({
        baseURL: 'https://api.bitbucket.org/2.0',
        auth: {
          username: 'test-user',
          password: 'test-api-token'
        },
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        timeout: 10000
      });
    });

    test('createClient throws error with missing credentials', () => {
      const config = { workspace: 'test', username: '', apiToken: '' };
      const client = new BitbucketClient();
      
      expect(() => client.createClient(config)).toThrow(
        'Missing required Bitbucket API configuration'
      );
    });
  });

  describe('Configuration Validation', () => {
    let mockLogger;

    beforeEach(() => {
      mockLogger = {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn()
      };
    });

    test('validateConfig returns success for valid configuration', () => {
      const client = new BitbucketClient();
      const result = client.validateConfig(mockLogger);
      
      expect(result.success).toBe(true);
      expect(result.missingFields).toEqual([]);
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    test('validateConfig identifies missing fields', () => {
      const client = new BitbucketClient({
        workspace: '',
        username: 'test-user',
        apiToken: ''
      });
      
      const result = client.validateConfig(mockLogger);
      
      expect(result.success).toBe(false);
      expect(result.missingFields).toContain('workspace');
      expect(result.missingFields).toContain('apiToken');
      expect(result.missingFields).not.toContain('username');
    });

    test('validateConfig logs helpful error messages', () => {
      const client = new BitbucketClient({
        workspace: '',
        username: '',
        apiToken: ''
      });
      
      client.validateConfig(mockLogger);
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Bitbucket configuration validation failed')
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('BITBUCKET_WORKSPACE')
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('BITBUCKET_USERNAME')
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('BITBUCKET_API_TOKEN')
      );
    });
  });

  describe('Client Access Methods', () => {
    test('getClient returns axios instance when ready', () => {
      const client = new BitbucketClient();
      const axiosClient = client.getClient();
      
      expect(axiosClient).toBe(mockAxiosInstance);
    });

    test('getClient throws error when not enabled', () => {
      delete process.env.BITBUCKET_WORKSPACE;
      const client = new BitbucketClient();
      
      expect(() => client.getClient()).toThrow(
        'Bitbucket integration is not enabled'
      );
    });

    test('getClient throws error when client failed to initialize', () => {
      axios.create.mockImplementation(() => {
        throw new Error('Init failed');
      });
      
      const client = new BitbucketClient();
      
      expect(() => client.getClient()).toThrow(
        'Bitbucket client initialization failed: Init failed'
      );
    });
  });

  describe('API Operations', () => {
    let client;

    beforeEach(() => {
      client = new BitbucketClient();
    });

    describe('fetchPullRequests', () => {
      test('fetches pull requests successfully', async () => {
        const mockResponse = {
          data: {
            values: [
              {
                id: 1,
                title: 'Test PR',
                state: 'OPEN'
              }
            ],
            page: 1,
            size: 1,
            pagelen: 50
          }
        };
        
        mockAxiosInstance.get.mockResolvedValue(mockResponse);
        
        const result = await client.fetchPullRequests('test-repo');
        
        expect(result.success).toBe(true);
        expect(result.data.pullRequests).toHaveLength(1);
        expect(result.data.pullRequests[0].title).toBe('Test PR');
        expect(mockAxiosInstance.get).toHaveBeenCalledWith(
          '/repositories/test-workspace/test-repo/pullrequests',
          { params: { page: 1, pagelen: 50 } }
        );
      });

      test('handles authentication errors', async () => {
        const authError = new Error('Auth failed');
        authError.response = { status: 401 };
        mockAxiosInstance.get.mockRejectedValue(authError);
        
        const result = await client.fetchPullRequests('test-repo');
        
        expect(result.success).toBe(false);
        expect(result.error.code).toBe('BITBUCKET_AUTH_ERROR');
        expect(result.error.message).toContain('Authentication failed');
      });

      test('handles repository not found errors', async () => {
        const notFoundError = new Error('Not found');
        notFoundError.response = { status: 404 };
        mockAxiosInstance.get.mockRejectedValue(notFoundError);
        
        const result = await client.fetchPullRequests('nonexistent-repo');
        
        expect(result.success).toBe(false);
        expect(result.error.code).toBe('BITBUCKET_REPO_NOT_FOUND');
        expect(result.error.message).toContain('Repository nonexistent-repo not found');
      });

      test('handles rate limiting', async () => {
        const rateLimitError = new Error('Rate limited');
        rateLimitError.response = { status: 429 };
        mockAxiosInstance.get.mockRejectedValue(rateLimitError);
        
        const result = await client.fetchPullRequests('test-repo');
        
        expect(result.success).toBe(false);
        expect(result.error.code).toBe('BITBUCKET_RATE_LIMIT');
        expect(result.error.message).toContain('Rate limit exceeded');
      });

      test('supports filtering by state', async () => {
        mockAxiosInstance.get.mockResolvedValue({ data: { values: [] } });
        
        await client.fetchPullRequests('test-repo', { state: 'MERGED' });
        
        expect(mockAxiosInstance.get).toHaveBeenCalledWith(
          '/repositories/test-workspace/test-repo/pullrequests',
          { params: { page: 1, pagelen: 50, state: 'MERGED' } }
        );
      });

      test('returns error when client not ready', async () => {
        delete process.env.BITBUCKET_WORKSPACE;
        const disabledClient = new BitbucketClient();
        
        const result = await disabledClient.fetchPullRequests('test-repo');
        
        expect(result.success).toBe(false);
        expect(result.error.code).toBe('BITBUCKET_NOT_ENABLED');
      });
    });

    describe('fetchPRDiffStat', () => {
      test('fetches diff statistics successfully', async () => {
        const mockResponse = {
          data: {
            values: [
              { file: 'test.js', lines_added: 10, lines_removed: 5 }
            ],
            size: 1
          }
        };
        
        mockAxiosInstance.get.mockResolvedValue(mockResponse);
        
        const result = await client.fetchPRDiffStat('test-repo', 123);
        
        expect(result.success).toBe(true);
        expect(result.data.diffStat).toHaveLength(1);
        expect(result.data.totalFiles).toBe(1);
        expect(mockAxiosInstance.get).toHaveBeenCalledWith(
          '/repositories/test-workspace/test-repo/pullrequests/123/diffstat'
        );
      });

      test('handles PR not found errors', async () => {
        const notFoundError = new Error('PR not found');
        notFoundError.response = { status: 404 };
        mockAxiosInstance.get.mockRejectedValue(notFoundError);
        
        const result = await client.fetchPRDiffStat('test-repo', 999);
        
        expect(result.success).toBe(false);
        expect(result.error.code).toBe('BITBUCKET_PR_NOT_FOUND');
        expect(result.error.message).toContain('Pull request 999 not found');
      });
    });

    describe('fetchPRCommits', () => {
      test('fetches PR commits successfully', async () => {
        const mockResponse = {
          data: {
            values: [
              {
                hash: 'abc123',
                message: 'Test commit',
                date: '2024-01-15T10:30:00Z'
              }
            ],
            page: 1,
            size: 1,
            pagelen: 50
          }
        };
        
        mockAxiosInstance.get.mockResolvedValue(mockResponse);
        
        const result = await client.fetchPRCommits('test-repo', 123);
        
        expect(result.success).toBe(true);
        expect(result.data.commits).toHaveLength(1);
        expect(result.data.commits[0].message).toBe('Test commit');
        expect(mockAxiosInstance.get).toHaveBeenCalledWith(
          '/repositories/test-workspace/test-repo/pullrequests/123/commits',
          { params: { page: 1, pagelen: 50 } }
        );
      });

      test('supports pagination options', async () => {
        mockAxiosInstance.get.mockResolvedValue({ data: { values: [] } });
        
        await client.fetchPRCommits('test-repo', 123, { page: 2, pagelen: 25 });
        
        expect(mockAxiosInstance.get).toHaveBeenCalledWith(
          '/repositories/test-workspace/test-repo/pullrequests/123/commits',
          { params: { page: 2, pagelen: 25 } }
        );
      });
    });

    describe('testConnection', () => {
      test('successfully tests connection', async () => {
        mockAxiosInstance.get.mockResolvedValue({ data: { username: 'test-user' } });
        
        const result = await client.testConnection();
        
        expect(result.success).toBe(true);
        expect(result.message).toBe('Bitbucket connection successful');
        expect(mockAxiosInstance.get).toHaveBeenCalledWith('/user');
      });

      test('handles authentication failure in connection test', async () => {
        const authError = new Error('Unauthorized');
        authError.response = { status: 401 };
        mockAxiosInstance.get.mockRejectedValue(authError);
        
        const result = await client.testConnection();
        
        expect(result.success).toBe(false);
        expect(result.error.code).toBe('BITBUCKET_AUTH_ERROR');
      });

      test('handles general connection errors', async () => {
        const networkError = new Error('Network error');
        mockAxiosInstance.get.mockRejectedValue(networkError);
        
        const result = await client.testConnection();
        
        expect(result.success).toBe(false);
        expect(result.error.code).toBe('BITBUCKET_CONNECTION_ERROR');
        expect(result.error.message).toContain('Connection test failed');
      });
    });
  });

  describe('Error Response Creation', () => {
    test('createErrorResponse formats errors correctly', () => {
      const client = new BitbucketClient();
      const error = client.createErrorResponse(
        'TEST_ERROR',
        'Test error message',
        { extra: 'details' }
      );
      
      expect(error).toEqual({
        success: false,
        error: {
          code: 'TEST_ERROR',
          message: 'Test error message',
          extra: 'details'
        }
      });
    });

    test('createErrorResponse works without details', () => {
      const client = new BitbucketClient();
      const error = client.createErrorResponse('TEST_ERROR', 'Test message');
      
      expect(error).toEqual({
        success: false,
        error: {
          code: 'TEST_ERROR',
          message: 'Test message'
        }
      });
    });
  });
}); 