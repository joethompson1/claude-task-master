/**
 * jira-client.js
 * 
 * Class for interacting with Jira API. Encapsulates authentication, requests,
 * and provides methods for Jira operations.
 */

import axios from 'axios';
import { CONFIG } from '../../../../scripts/modules/utils.js';
import { JiraTicket } from './jira-ticket.js';

/**
 * JiraClient class for interacting with Jira API
 */
export class JiraClient {
	/**
	 * Create a new JiraClient instance
	 * @param {Object} [config] - Optional Jira configuration to override environment variables
	 */
	constructor(config) {
		this.config = config || JiraClient.getJiraConfig();
		this.enabled = JiraClient.isJiraEnabled();
		
		if (this.enabled) {
			try {
				this.client = this.createJiraClient(this.config);
			} catch (error) {
				this.client = null;
				this.error = error.message;
			}
		} else {
			this.client = null;
		}
	}

	/**
	 * Get Jira API configuration from environment variables or CONFIG
	 * @returns {Object} Jira API configuration
	 */
	static getJiraConfig() {
		return {
			baseUrl: process.env.JIRA_API_URL || CONFIG.jiraApiUrl,
			email: process.env.JIRA_EMAIL || CONFIG.jiraEmail,
			apiToken: process.env.JIRA_API_TOKEN || CONFIG.jiraApiToken,
			project: process.env.JIRA_PROJECT || CONFIG.jiraProject,
		};
	}

	/**
	 * Checks if the required Jira environment variables are set
	 * @returns {boolean} True if Jira environment is configured
	 */
	static isJiraEnabled() {
		const requiredVars = ['JIRA_API_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT'];
		return requiredVars.every(varName => !!process.env[varName]);
	}

	/**
	 * Create an authenticated Axios instance for Jira API requests
	 * @param {Object} config - Jira configuration
	 * @returns {Object} Axios instance configured for Jira
	 */
	createJiraClient(config) {
		const { baseUrl, email, apiToken } = config;
		
		if (!baseUrl || !email || !apiToken) {
			throw new Error('Missing required Jira API configuration. Please set JIRA_API_URL, JIRA_EMAIL, and JIRA_API_TOKEN environment variables.');
		}
		
		return axios.create({
			baseURL: baseUrl,
			auth: {
				username: email,
				password: apiToken
			},
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'application/json'
			}
		});
	}

	/**
	 * Validates the current Jira configuration
	 * @param {Object} log - Logger object
	 * @returns {Object} - Validation result with success flag and error message if invalid
	 */
	validateConfig(log) {
		const result = {
			success: true,
			missingFields: []
		};
		
		// Check required fields
		if (!this.config.baseUrl) {
			result.success = false;
			result.missingFields.push('baseUrl');
		}
		
		if (!this.config.email) {
			result.success = false;
			result.missingFields.push('email');
		}
		
		if (!this.config.apiToken) {
			result.success = false;
			result.missingFields.push('apiToken');
		}
		
		if (!this.config.project) {
			result.success = false;
			result.missingFields.push('project');
		}
		
		// Log validation result if a logger is provided
		if (log && !result.success) {
			log.error(`Jira configuration validation failed. Missing fields: ${result.missingFields.join(', ')}`);
			log.error('Please set the following environment variables or configuration values:');
			if (result.missingFields.includes('baseUrl')) {
				log.error('- JIRA_API_URL: Your Jira instance URL (e.g., "https://your-domain.atlassian.net")');
			}
			if (result.missingFields.includes('email')) {
				log.error('- JIRA_EMAIL: Email address associated with your Jira account');
			}
			if (result.missingFields.includes('apiToken')) {
				log.error('- JIRA_API_TOKEN: API token generated from your Atlassian account');
			}
			if (result.missingFields.includes('project')) {
				log.error('- JIRA_PROJECT: Your Jira project key (e.g., "PROJ")');
			}
		}
		
		return result;
	}

	/**
	 * Get the initialized Jira API client or throw an error if not available
	 * @returns {Object} Axios Jira client instance
	 * @throws {Error} If Jira is not enabled or client failed to initialize
	 */
	getClient() {
		if (!this.enabled) {
			throw new Error('Jira integration is not enabled. Please configure the required environment variables.');
		}
		
		if (!this.client) {
			throw new Error(`Jira client initialization failed: ${this.error || 'Unknown error'}`);
		}
		
		return this.client;
	}

	/**
	 * Check if Jira integration is enabled and client is ready
	 * @returns {boolean} True if Jira client is ready to use
	 */
	isReady() {
		return this.enabled && !!this.client;
	}

	/**
	 * Standard error response generator for Jira operations
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
				...(details ? { details } : {})
			}
		};
	}

	/**
	 * Fetch a single Jira issue by its key
	 * @param {string} issueKey - Jira issue key to fetch
	 * @param {Object} [options] - Additional options
	 * @param {boolean} [options.expand=true] - Whether to expand fields like renderedFields
	 * @param {Object} [options.log] - Logger object
	 * @returns {Promise<{success: boolean, data: JiraTicket, error: Object}>} - Result with success status and issue data/error
	 */
	async fetchIssue(issueKey, options = {}) {
		const log = options.log || console;
		const expand = options.expand !== undefined ? options.expand : true;
		
		try {
			if (!this.isReady()) {
				return this.createErrorResponse('JIRA_NOT_ENABLED', 'Jira integration is not properly configured');
			}
			
			log.info?.(`Fetching Jira issue with key: ${issueKey}`);
			
			const client = this.getClient();
			const response = await client.get(`/rest/api/3/issue/${issueKey}`, {
				params: {
					fields: 'summary,description,status,priority,issuetype,parent,issuelinks,subtasks',
					...(expand ? { expand: 'renderedFields' } : {})
				}
			});
			
			if (!response.data) {
				return this.createErrorResponse('JIRA_INVALID_RESPONSE', 'Invalid response from Jira API');
			}

			return {
				success: true,
				data: await JiraTicket.fromJiraIssue(response.data)
			};
		} catch (error) {
			log.error?.(`Error fetching Jira issue: ${error.message}`);
			return this.createErrorResponse(
				'JIRA_REQUEST_ERROR',
				`Failed to fetch issue: ${error.message}`,
				error.response?.data
			);
		}
	}

	/**
	 * Search for Jira issues using JQL
	 * @param {string} jql - JQL query string
	 * @param {Object} [options] - Additional options
	 * @param {number} [options.maxResults=100] - Maximum number of results to return
	 * @param {boolean} [options.expand=true] - Whether to expand fields like renderedFields
	 * @param {Object} [options.log] - Logger object
	 * @returns {Promise<{success: boolean, data: JiraTicket[], error: Object}>} - Result with success status and array of JiraTicket objects
	 */
	async searchIssues(jql, options = {}) {
		const log = options.log || console;
		const maxResults = options.maxResults || 100;
		const expand = options.expand !== undefined ? options.expand : true;
		
		try {
			if (!this.isReady()) {
				return this.createErrorResponse('JIRA_NOT_ENABLED', 'Jira integration is not properly configured');
			}
			
			log.info?.(`Searching Jira issues with JQL: ${jql}`);
			
			const client = this.getClient();
			const response = await client.get('/rest/api/3/search', {
				params: {
					jql,
					maxResults,
					fields: 'summary,description,status,priority,issuetype,parent,issuelinks,subtasks',
					...(expand ? { expand: 'renderedFields' } : {})
				}
			});
			
			if (!response.data || !response.data.issues) {
				return this.createErrorResponse('JIRA_INVALID_RESPONSE', 'Invalid response from Jira API');
			}
			
			// Convert each issue to a JiraTicket object
			const jiraTickets = await Promise.all(
				response.data.issues.map(issue => JiraTicket.fromJiraIssue(issue))
			);
			
			// Return the modified response with JiraTicket objects
			return {
				success: true,
				data: jiraTickets
			};
		} catch (error) {
			log.error?.(`Error searching Jira issues: ${error.message}`);
			return this.createErrorResponse(
				'JIRA_REQUEST_ERROR',
				`Failed to search issues: ${error.message}`,
				error.response?.data
			);
		}
	}

	/**
	 * Create a new Jira issue
	 * @param {JiraTicket} issueData - Data for the new issue
	 * @param {Object} [options] - Additional options
	 * @param {Object} [options.log] - Logger object
	 * @returns {Promise<{success: boolean, data: Object, error: Object}>} - Result with success status and created issue data/error
	 */
	async createIssue(issueData, options = {}) {
		const log = options.log || console;
		
		try {
			if (!this.isReady()) {
				return this.createErrorResponse('JIRA_NOT_ENABLED', 'Jira integration is not properly configured');
			}
			
			log.info?.(`Creating new Jira issue`);
			
			const client = this.getClient();
			const response = await client.post('/rest/api/3/issue', issueData.toJiraRequestData());
			
			if (!response.data) {
				return this.createErrorResponse('JIRA_INVALID_RESPONSE', 'Invalid response from Jira API');
			}
			
			return {
				success: true,
				data: response.data
			};
		} catch (error) {
			log.error?.(`Error creating Jira issue: ${error.message}`);
			return this.createErrorResponse(
				'JIRA_REQUEST_ERROR',
				`Failed to create issue: ${error.message}`,
				error.response?.data
			);
		}
	}

	/**
	 * Update an existing Jira issue
	 * @param {string} issueKey - Key of the issue to update
	 * @param {Object} issueData - Updated issue data
	 * @param {Object} [options] - Additional options
	 * @param {Object} [options.log] - Logger object
	 * @returns {Promise<Object>} - Result with success status and updated issue data/error
	 */
	async updateIssue(issueKey, issueData, options = {}) {
		const log = options.log || console;
		
		try {
			if (!this.isReady()) {
				return this.createErrorResponse('JIRA_NOT_ENABLED', 'Jira integration is not properly configured');
			}
			
			log.info?.(`Updating Jira issue ${issueKey}`);
			
			const client = this.getClient();
			const response = await client.put(`/rest/api/3/issue/${issueKey}`, issueData);
			
			// Jira returns 204 No Content for successful updates
			return {
				success: true,
				data: { issueKey }
			};
		} catch (error) {
			log.error?.(`Error updating Jira issue: ${error.message}`);
			return this.createErrorResponse(
				'JIRA_REQUEST_ERROR',
				`Failed to update issue: ${error.message}`,
				error.response?.data
			);
		}
	}

	/**
	 * Transition a Jira issue to a new status
	 * @param {string} issueKey - Key of the issue to transition
	 * @param {string} transitionName - Name of the transition to perform
	 * @param {Object} [options] - Additional options
	 * @param {Object} [options.log] - Logger object
	 * @returns {Promise<Object>} - Result with success status and transition data/error
	 */
	async transitionIssue(issueKey, transitionName, options = {}) {
		const log = options.log || console;
		
		try {
			if (!this.isReady()) {
				return this.createErrorResponse('JIRA_NOT_ENABLED', 'Jira integration is not properly configured');
			}
			
			log.info?.(`Transitioning Jira issue ${issueKey} to ${transitionName}`);
			
			// First, get available transitions
			const client = this.getClient();
			const transitionsResponse = await client.get(`/rest/api/3/issue/${issueKey}/transitions`);
			
			if (!transitionsResponse.data || !transitionsResponse.data.transitions) {
				return this.createErrorResponse('JIRA_INVALID_RESPONSE', 'Invalid transitions response from Jira API');
			}
			
			// Find the transition ID by name
			const transition = transitionsResponse.data.transitions.find(
				t => t.name.toLowerCase() === transitionName.toLowerCase()
			);
			
			if (!transition) {
				return this.createErrorResponse(
					'JIRA_INVALID_TRANSITION',
					`Transition '${transitionName}' not found for issue ${issueKey}`,
					{ availableTransitions: transitionsResponse.data.transitions.map(t => t.name) }
				);
			}
			
			// Perform the transition
			await client.post(`/rest/api/3/issue/${issueKey}/transitions`, {
				transition: { id: transition.id }
			});
			
			return {
				success: true,
				data: { issueKey, transition: transitionName }
			};
		} catch (error) {
			log.error?.(`Error transitioning Jira issue: ${error.message}`);
			return this.createErrorResponse(
				'JIRA_REQUEST_ERROR',
				`Failed to transition issue: ${error.message}`,
				error.response?.data
			);
		}
	}

	/**
	 * Get available transitions for a Jira issue
	 * @param {string} issueKey - Key of the issue to get transitions for
	 * @param {Object} [options] - Additional options
	 * @param {Object} [options.log] - Logger object
	 * @returns {Promise<Object>} - Result with success status and transitions data/error
	 */
	async getTransitions(issueKey, options = {}) {
		const log = options.log || console;
		
		try {
			if (!this.isReady()) {
				return this.createErrorResponse('JIRA_NOT_ENABLED', 'Jira integration is not properly configured');
			}
			
			log.info?.(`Getting transitions for Jira issue ${issueKey}`);
			
			const client = this.getClient();
			const response = await client.get(`/rest/api/3/issue/${issueKey}/transitions`);
			
			if (!response.data || !response.data.transitions) {
				return this.createErrorResponse('JIRA_INVALID_RESPONSE', 'Invalid transitions response from Jira API');
			}
			
			return {
				success: true,
				data: response.data
			};
		} catch (error) {
			log.error?.(`Error getting Jira transitions: ${error.message}`);
			return this.createErrorResponse(
				'JIRA_REQUEST_ERROR',
				`Failed to get transitions: ${error.message}`,
				error.response?.data
			);
		}
	}
} 