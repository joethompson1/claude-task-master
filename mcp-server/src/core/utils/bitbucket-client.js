/**
 * bitbucket-client.js
 *
 * Class for interacting with Bitbucket API. Encapsulates authentication, requests,
 * and provides methods for Bitbucket operations including pull requests and commits.
 */

import axios from 'axios';

/**
 * BitbucketClient class for interacting with Bitbucket API
 */
export class BitbucketClient {
	/**
	 * Create a new BitbucketClient instance
	 * @param {Object} [config] - Optional Bitbucket configuration to override environment variables
	 */
	constructor(config) {
		this.config = config || BitbucketClient.getBitbucketConfig();
		this.enabled = BitbucketClient.isBitbucketEnabled();

		if (this.enabled) {
			try {
				this.client = this.createClient(this.config);
			} catch (error) {
				this.client = null;
				this.error = error.message;
			}
		} else {
			this.client = null;
		}
	}

	/**
	 * Get Bitbucket API configuration from environment variables
	 * @returns {Object} Bitbucket API configuration
	 */
	static getBitbucketConfig() {
		return {
			workspace: process.env.BITBUCKET_WORKSPACE,
			username: process.env.BITBUCKET_USERNAME,
			apiToken: process.env.BITBUCKET_API_TOKEN,
			defaultRepo: process.env.BITBUCKET_DEFAULT_REPO
		};
	}

	/**
	 * Checks if the required Bitbucket environment variables are set
	 * @returns {boolean} True if Bitbucket environment is configured
	 */
	static isBitbucketEnabled() {
		const requiredVars = [
			'BITBUCKET_WORKSPACE',
			'BITBUCKET_USERNAME',
			'BITBUCKET_API_TOKEN'
		];
		return requiredVars.every((varName) => !!process.env[varName]);
	}

	/**
	 * Create an authenticated Axios instance for Bitbucket API requests
	 * @param {Object} config - Bitbucket configuration
	 * @returns {Object} Axios instance configured for Bitbucket
	 */
	createClient(config) {
		const { username, apiToken } = config;

		if (!username || !apiToken) {
			throw new Error(
				'Missing required Bitbucket API configuration. Please set BITBUCKET_USERNAME and BITBUCKET_API_TOKEN environment variables.'
			);
		}

		return axios.create({
			baseURL: 'https://api.bitbucket.org/2.0',
			auth: {
				username: username,
				password: apiToken
			},
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json'
			},
			timeout: 10000 // 10 second timeout
		});
	}

	/**
	 * Validates the current Bitbucket configuration
	 * @param {Object} log - Logger object
	 * @returns {Object} - Validation result with success flag and error message if invalid
	 */
	validateConfig(log) {
		const result = {
			success: true,
			missingFields: []
		};

		// Check required fields
		if (!this.config.workspace) {
			result.success = false;
			result.missingFields.push('workspace');
		}

		if (!this.config.username) {
			result.success = false;
			result.missingFields.push('username');
		}

		if (!this.config.apiToken) {
			result.success = false;
			result.missingFields.push('apiToken');
		}

		// Log validation result if a logger is provided
		if (log && !result.success) {
			log.error(
				`Bitbucket configuration validation failed. Missing fields: ${result.missingFields.join(', ')}`
			);
			log.error(
				'Please set the following environment variables or configuration values:'
			);
			if (result.missingFields.includes('workspace')) {
				log.error(
					'- BITBUCKET_WORKSPACE: Your Bitbucket workspace name'
				);
			}
			if (result.missingFields.includes('username')) {
				log.error(
					'- BITBUCKET_USERNAME: Your Bitbucket username'
				);
			}
			if (result.missingFields.includes('apiToken')) {
				log.error(
					'- BITBUCKET_API_TOKEN: Universal API token from your Atlassian account'
				);
			}
		}

		return result;
	}

	/**
	 * Get the initialized Bitbucket API client or throw an error if not available
	 * @returns {Object} Axios Bitbucket client instance
	 * @throws {Error} If Bitbucket is not enabled or client failed to initialize
	 */
	getClient() {
		if (!this.enabled) {
			throw new Error(
				'Bitbucket integration is not enabled. Please configure the required environment variables.'
			);
		}

		if (!this.client) {
			throw new Error(
				`Bitbucket client initialization failed: ${this.error || 'Unknown error'}`
			);
		}

		return this.client;
	}

	/**
	 * Check if Bitbucket integration is enabled and client is ready
	 * @returns {boolean} True if Bitbucket client is ready to use
	 */
	isReady() {
		return this.enabled && !!this.client;
	}

	/**
	 * Standard error response generator for Bitbucket operations
	 * @param {string} code - Error code
	 * @param {string} message - Error message
	 * @param {Object} [details] - Additional error details
	 * @returns {Object} Standard error response object
	 */
	createErrorResponse(code, message, details = null) {
		return {
			success: false,
			error: {
				code,
				message,
				...(details || {})
			}
		};
	}

	/**
	 * Fetch pull requests for a repository
	 * @param {string} repoSlug - Repository name/slug
	 * @param {Object} [options] - Additional options for the request
	 * @param {string} [options.state] - PR state filter (OPEN, MERGED, DECLINED)
	 * @param {number} [options.page] - Page number for pagination
	 * @param {number} [options.pagelen] - Number of items per page (max 100)
	 * @returns {Promise<Object>} Pull requests data or error response
	 */
	async fetchPullRequests(repoSlug, options = {}) {
		try {
			if (!this.isReady()) {
				return this.createErrorResponse(
					'BITBUCKET_NOT_ENABLED',
					'Bitbucket client is not enabled or ready'
				);
			}

			const client = this.getClient();
			const { workspace } = this.config;
			const { state, page = 1, pagelen = 50 } = options;

			// Build query parameters
			const params = { page, pagelen };
			if (state) {
				params.state = state;
			}

			const response = await client.get(
				`/repositories/${workspace}/${repoSlug}/pullrequests`,
				{ params }
			);

			return {
				success: true,
				data: {
					pullRequests: response.data.values || [],
					pagination: {
						page: response.data.page || 1,
						size: response.data.size || 0,
						pagelen: response.data.pagelen || 50,
						next: response.data.next || null
					}
				}
			};
		} catch (error) {
			if (error.response?.status === 401) {
				return this.createErrorResponse(
					'BITBUCKET_AUTH_ERROR',
					'Authentication failed. Please check your Bitbucket credentials.',
					{ status: error.response.status }
				);
			}

			if (error.response?.status === 404) {
				return this.createErrorResponse(
					'BITBUCKET_REPO_NOT_FOUND',
					`Repository ${repoSlug} not found in workspace ${this.config.workspace}`,
					{ status: error.response.status }
				);
			}

			if (error.response?.status === 429) {
				return this.createErrorResponse(
					'BITBUCKET_RATE_LIMIT',
					'Rate limit exceeded. Please try again later.',
					{ status: error.response.status }
				);
			}

			return this.createErrorResponse(
				'BITBUCKET_REQUEST_ERROR',
				`Failed to fetch pull requests: ${error.message}`,
				{ originalError: error.message }
			);
		}
	}

	/**
	 * Fetch diff statistics for a pull request
	 * @param {string} repoSlug - Repository name/slug
	 * @param {number} prId - Pull request ID
	 * @param {Object} [options] - Additional options for the request
	 * @returns {Promise<Object>} Diff statistics or error response
	 */
	async fetchPRDiffStat(repoSlug, prId, options = {}) {
		try {
			if (!this.isReady()) {
				return this.createErrorResponse(
					'BITBUCKET_NOT_ENABLED',
					'Bitbucket client is not enabled or ready'
				);
			}

			const client = this.getClient();
			const { workspace } = this.config;

			const response = await client.get(
				`/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/diffstat`
			);

			return {
				success: true,
				data: {
					diffStat: response.data.values || [],
					totalFiles: response.data.size || 0
				}
			};
		} catch (error) {
			if (error.response?.status === 404) {
				return this.createErrorResponse(
					'BITBUCKET_PR_NOT_FOUND',
					`Pull request ${prId} not found in repository ${repoSlug}`,
					{ status: error.response.status }
				);
			}

			return this.createErrorResponse(
				'BITBUCKET_REQUEST_ERROR',
				`Failed to fetch PR diff statistics: ${error.message}`,
				{ originalError: error.message }
			);
		}
	}

	/**
	 * Fetch commits for a pull request
	 * @param {string} repoSlug - Repository name/slug
	 * @param {number} prId - Pull request ID
	 * @param {Object} [options] - Additional options for the request
	 * @param {number} [options.page] - Page number for pagination
	 * @param {number} [options.pagelen] - Number of items per page
	 * @returns {Promise<Object>} PR commits or error response
	 */
	async fetchPRCommits(repoSlug, prId, options = {}) {
		try {
			if (!this.isReady()) {
				return this.createErrorResponse(
					'BITBUCKET_NOT_ENABLED',
					'Bitbucket client is not enabled or ready'
				);
			}

			const client = this.getClient();
			const { workspace } = this.config;
			const { page = 1, pagelen = 50 } = options;

			const response = await client.get(
				`/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/commits`,
				{ params: { page, pagelen } }
			);

			return {
				success: true,
				data: {
					commits: response.data.values || [],
					pagination: {
						page: response.data.page || 1,
						size: response.data.size || 0,
						pagelen: response.data.pagelen || 50,
						next: response.data.next || null
					}
				}
			};
		} catch (error) {
			if (error.response?.status === 404) {
				return this.createErrorResponse(
					'BITBUCKET_PR_NOT_FOUND',
					`Pull request ${prId} not found in repository ${repoSlug}`,
					{ status: error.response.status }
				);
			}

			return this.createErrorResponse(
				'BITBUCKET_REQUEST_ERROR',
				`Failed to fetch PR commits: ${error.message}`,
				{ originalError: error.message }
			);
		}
	}

	/**
	 * Test the Bitbucket connection by making a simple API call
	 * @returns {Promise<Object>} Connection test result
	 */
	async testConnection() {
		try {
			if (!this.isReady()) {
				return this.createErrorResponse(
					'BITBUCKET_NOT_ENABLED',
					'Bitbucket client is not enabled or ready'
				);
			}

			const client = this.getClient();
			
			// Test with a simple user info call
			await client.get('/user');

			return {
				success: true,
				message: 'Bitbucket connection successful'
			};
		} catch (error) {
			if (error.response?.status === 401) {
				return this.createErrorResponse(
					'BITBUCKET_AUTH_ERROR',
					'Authentication failed. Please check your Bitbucket credentials.'
				);
			}

			return this.createErrorResponse(
				'BITBUCKET_CONNECTION_ERROR',
				`Connection test failed: ${error.message}`
			);
		}
	}
} 