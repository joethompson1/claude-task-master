/**
 * jira-client.js
 *
 * Class for interacting with Jira API. Encapsulates authentication, requests,
 * and provides methods for Jira operations.
 */

import axios from 'axios';
import { JiraTicket } from './jira-ticket.js';
import { compressImageIfNeeded } from './jira-utils.js';

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
			baseUrl: process.env.JIRA_API_URL,
			email: process.env.JIRA_EMAIL,
			apiToken: process.env.JIRA_API_TOKEN,
			project: process.env.JIRA_PROJECT
		};
	}

	/**
	 * Checks if the required Jira environment variables are set
	 * @returns {boolean} True if Jira environment is configured
	 */
	static isJiraEnabled() {
		const requiredVars = [
			'JIRA_API_URL',
			'JIRA_EMAIL',
			'JIRA_API_TOKEN',
			'JIRA_PROJECT'
		];
		return requiredVars.every((varName) => !!process.env[varName]);
	}

	/**
	 * Create an authenticated Axios instance for Jira API requests
	 * @param {Object} config - Jira configuration
	 * @returns {Object} Axios instance configured for Jira
	 */
	createJiraClient(config) {
		const { baseUrl, email, apiToken } = config;

		if (!baseUrl || !email || !apiToken) {
			throw new Error(
				'Missing required Jira API configuration. Please set JIRA_API_URL, JIRA_EMAIL, and JIRA_API_TOKEN environment variables.'
			);
		}

		return axios.create({
			baseURL: baseUrl,
			auth: {
				username: email,
				password: apiToken
			},
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json'
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
			log.error(
				`Jira configuration validation failed. Missing fields: ${result.missingFields.join(', ')}`
			);
			log.error(
				'Please set the following environment variables or configuration values:'
			);
			if (result.missingFields.includes('baseUrl')) {
				log.error(
					'- JIRA_API_URL: Your Jira instance URL (e.g., "https://your-domain.atlassian.net")'
				);
			}
			if (result.missingFields.includes('email')) {
				log.error(
					'- JIRA_EMAIL: Email address associated with your Jira account'
				);
			}
			if (result.missingFields.includes('apiToken')) {
				log.error(
					'- JIRA_API_TOKEN: API token generated from your Atlassian account'
				);
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
			throw new Error(
				'Jira integration is not enabled. Please configure the required environment variables.'
			);
		}

		if (!this.client) {
			throw new Error(
				`Jira client initialization failed: ${this.error || 'Unknown error'}`
			);
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
	 * @param {boolean} [options.includeImages=true] - Whether to fetch and include image attachments
	 * @param {Object} [options.log] - Logger object
	 * @returns {Promise<{success: boolean, data: JiraTicket, error: Object}>} - Result with success status and issue data/error
	 */
	async fetchIssue(issueKey, options = {}) {
		const log = options.log || {
			info: () => {},
			warn: () => {},
			error: () => {},
			debug: () => {}
		};
		const expand = options.expand !== undefined ? options.expand : true;
		const includeImages =
			options.includeImages !== undefined ? options.includeImages : true;

		try {
			if (!this.isReady()) {
				return this.createErrorResponse(
					'JIRA_NOT_ENABLED',
					'Jira integration is not properly configured'
				);
			}

			log.info?.(
				`Fetching Jira issue with key: ${issueKey}${includeImages === false ? ' (excluding images)' : ''}`
			);

			const client = this.getClient();
			const response = await client.get(`/rest/api/3/issue/${issueKey}`, {
				params: {
					fields:
						'summary,description,status,priority,issuetype,parent,issuelinks,subtasks,attachment',
					...(expand ? { expand: 'renderedFields' } : {})
				}
			});

			if (!response.data) {
				return this.createErrorResponse(
					'JIRA_INVALID_RESPONSE',
					'Invalid response from Jira API'
				);
			}

			const jiraTicket = await JiraTicket.fromJiraIssue(response.data);

			// Conditionally fetch image attachments if they exist and includeImages is true
			if (
				includeImages &&
				jiraTicket.attachments &&
				jiraTicket.attachments.length > 0
			) {
				log.info?.(
					`Found ${jiraTicket.attachments.length} attachments, checking for images...`
				);

				// Extract attachment IDs for image attachments only
				const imageAttachments = jiraTicket.attachments.filter(
					(att) => att.mimeType && att.mimeType.startsWith('image/')
				);

				if (imageAttachments.length > 0) {
					log.info?.(
						`Fetching ${imageAttachments.length} image attachments as base64...`
					);

					const attachmentIds = imageAttachments.map((att) => att.id);

					// Fetch attachment images as base64
					const attachmentsResult = await this.fetchAttachmentsAsBase64(
						attachmentIds,
						{
							log,
							thumbnail: false, // Use full images, not thumbnails
							compress: true, // Enable compression for MCP injection
							imageTypes: [
								'image/jpeg',
								'image/jpg',
								'image/png',
								'image/gif',
								'image/bmp',
								'image/webp',
								'image/svg+xml'
							],
							attachmentMetadata: imageAttachments // Pass the attachment metadata
						}
					);

					if (attachmentsResult.success) {
						// Add base64 data to the ticket
						jiraTicket.attachmentImages = attachmentsResult.data.attachments;
						jiraTicket.attachmentImageStats = {
							totalAttachments: jiraTicket.attachments.length,
							totalImages: attachmentsResult.data.totalFetched,
							totalErrors: attachmentsResult.data.totalErrors,
							isThumbnail: false
						};

						if (attachmentsResult.data.errors.length > 0) {
							log.warn?.(
								`Failed to fetch ${attachmentsResult.data.errors.length} attachment images`
							);
						} else {
							log.info?.(
								`Successfully fetched ${attachmentsResult.data.totalFetched} image attachments`
							);
						}
					} else {
						log.error?.(
							`Failed to fetch attachment images: ${attachmentsResult.error?.message}`
						);
					}
				}
			}

			return {
				success: true,
				data: jiraTicket
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
		const log = options.log || {
			info: () => {},
			warn: () => {},
			error: () => {},
			debug: () => {}
		};
		const maxResults = options.maxResults || 100;
		const expand = options.expand !== undefined ? options.expand : true;

		try {
			if (!this.isReady()) {
				return this.createErrorResponse(
					'JIRA_NOT_ENABLED',
					'Jira integration is not properly configured'
				);
			}

			log.info?.(`Searching Jira issues with JQL: ${jql}`);

			const client = this.getClient();
			const response = await client.get('/rest/api/3/search', {
				params: {
					jql,
					maxResults,
					fields:
						'summary,description,status,priority,issuetype,parent,issuelinks,subtasks,attachment',
					...(expand ? { expand: 'renderedFields' } : {})
				}
			});

			if (!response.data || !response.data.issues) {
				return this.createErrorResponse(
					'JIRA_INVALID_RESPONSE',
					'Invalid response from Jira API'
				);
			}

			// Convert each issue to a JiraTicket object
			const jiraTickets = await Promise.all(
				response.data.issues.map((issue) => JiraTicket.fromJiraIssue(issue))
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
		const log = options.log || {
			info: () => {},
			warn: () => {},
			error: () => {},
			debug: () => {}
		};

		try {
			if (!this.isReady()) {
				return this.createErrorResponse(
					'JIRA_NOT_ENABLED',
					'Jira integration is not properly configured'
				);
			}

			log.info?.(`Creating new Jira issue`);

			const client = this.getClient();
			const response = await client.post(
				'/rest/api/3/issue',
				issueData.toJiraRequestData()
			);

			if (!response.data) {
				return this.createErrorResponse(
					'JIRA_INVALID_RESPONSE',
					'Invalid response from Jira API'
				);
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
		const log = options.log || {
			info: () => {},
			warn: () => {},
			error: () => {},
			debug: () => {}
		};

		try {
			if (!this.isReady()) {
				return this.createErrorResponse(
					'JIRA_NOT_ENABLED',
					'Jira integration is not properly configured'
				);
			}

			log.info?.(`Updating Jira issue ${issueKey}`);

			const client = this.getClient();
			const response = await client.put(
				`/rest/api/3/issue/${issueKey}`,
				issueData
			);

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
		const log = options.log || {
			info: () => {},
			warn: () => {},
			error: () => {},
			debug: () => {}
		};

		try {
			if (!this.isReady()) {
				return this.createErrorResponse(
					'JIRA_NOT_ENABLED',
					'Jira integration is not properly configured'
				);
			}

			log.info?.(`Transitioning Jira issue ${issueKey} to ${transitionName}`);

			// First, get available transitions
			const client = this.getClient();
			const transitionsResponse = await client.get(
				`/rest/api/3/issue/${issueKey}/transitions`
			);

			if (!transitionsResponse.data || !transitionsResponse.data.transitions) {
				return this.createErrorResponse(
					'JIRA_INVALID_RESPONSE',
					'Invalid transitions response from Jira API'
				);
			}

			// Find the transition ID by name
			const transition = transitionsResponse.data.transitions.find(
				(t) => t.name.toLowerCase() === transitionName.toLowerCase()
			);

			if (!transition) {
				return this.createErrorResponse(
					'JIRA_INVALID_TRANSITION',
					`Transition '${transitionName}' not found for issue ${issueKey}`,
					{
						availableTransitions: transitionsResponse.data.transitions.map(
							(t) => t.name
						)
					}
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
		const log = options.log || {
			info: () => {},
			warn: () => {},
			error: () => {},
			debug: () => {}
		};

		try {
			if (!this.isReady()) {
				return this.createErrorResponse(
					'JIRA_NOT_ENABLED',
					'Jira integration is not properly configured'
				);
			}

			log.info?.(`Getting transitions for Jira issue ${issueKey}`);

			const client = this.getClient();
			const response = await client.get(
				`/rest/api/3/issue/${issueKey}/transitions`
			);

			if (!response.data || !response.data.transitions) {
				return this.createErrorResponse(
					'JIRA_INVALID_RESPONSE',
					'Invalid transitions response from Jira API'
				);
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

	/**
	 * Add a comment to a Jira issue
	 * @param {string} issueKey - Key of the issue to add a comment to
	 * @param {string} commentText - Text content of the comment to add
	 * @param {Object} [options] - Additional options
	 * @param {Object} [options.log] - Logger object
	 * @returns {Promise<Object>} - Result with success status and comment data/error
	 */
	async addComment(issueKey, commentText, options = {}) {
		const log = options.log || {
			info: () => {},
			warn: () => {},
			error: () => {},
			debug: () => {}
		};

		try {
			if (!this.isReady()) {
				return this.createErrorResponse(
					'JIRA_NOT_ENABLED',
					'Jira integration is not properly configured'
				);
			}

			if (!issueKey) {
				return this.createErrorResponse(
					'JIRA_INVALID_INPUT',
					'Issue key is required'
				);
			}

			if (!commentText) {
				return this.createErrorResponse(
					'JIRA_INVALID_INPUT',
					'Comment text is required'
				);
			}

			log.info?.(`Adding comment to Jira issue ${issueKey}`);

			const client = this.getClient();
			const response = await client.post(
				`/rest/api/3/issue/${issueKey}/comment`,
				{
					body: {
						type: 'doc',
						version: 1,
						content: [
							{
								type: 'paragraph',
								content: [
									{
										type: 'text',
										text: commentText
									}
								]
							}
						]
					}
				}
			);

			if (!response.data) {
				return this.createErrorResponse(
					'JIRA_INVALID_RESPONSE',
					'Invalid response from Jira API'
				);
			}

			return {
				success: true,
				data: response.data
			};
		} catch (error) {
			log.error?.(`Error adding comment to Jira issue: ${error.message}`);
			return this.createErrorResponse(
				'JIRA_REQUEST_ERROR',
				`Failed to add comment: ${error.message}`,
				error.response?.data
			);
		}
	}

	/**
	 * Fetch attachment metadata without downloading the full content
	 * @param {string} issueKey - The Jira issue key
	 * @param {Object} [options] - Additional options
	 * @param {Object} [options.log] - Logger object
	 * @returns {Promise<Object>} - Result with success status and attachments metadata
	 */
	async fetchAttachmentMetadata(issueKey, options = {}) {
		const log = options.log || {
			info: () => {},
			warn: () => {},
			error: () => {},
			debug: () => {}
		};

		try {
			if (!this.isReady()) {
				return this.createErrorResponse(
					'JIRA_NOT_ENABLED',
					'Jira integration is not properly configured'
				);
			}

			if (!issueKey) {
				return this.createErrorResponse(
					'JIRA_INVALID_INPUT',
					'Issue key is required'
				);
			}

			log.info?.(`Fetching attachment metadata for issue: ${issueKey}`);

			const client = this.getClient();
			const response = await client.get(`/rest/api/3/issue/${issueKey}`, {
				params: {
					fields: 'attachment'
				}
			});

			if (!response.data || !response.data.fields) {
				return this.createErrorResponse(
					'JIRA_INVALID_RESPONSE',
					'No issue data received from Jira API'
				);
			}

			const attachments = response.data.fields.attachment || [];

			// Map to a cleaner format
			const attachmentMetadata = attachments.map((att) => ({
				id: att.id,
				filename: att.filename,
				author: att.author
					? {
							accountId: att.author.accountId,
							displayName: att.author.displayName,
							emailAddress: att.author.emailAddress
						}
					: null,
				created: att.created,
				size: att.size,
				mimeType: att.mimeType,
				content: att.content, // URL for downloading
				thumbnail: att.thumbnail // URL for thumbnail if available
			}));

			return {
				success: true,
				data: {
					issueKey: issueKey,
					attachments: attachmentMetadata,
					totalAttachments: attachmentMetadata.length
				}
			};
		} catch (error) {
			log.error?.(`Error fetching attachment metadata: ${error.message}`);
			return this.createErrorResponse(
				'JIRA_REQUEST_ERROR',
				`Failed to fetch attachment metadata: ${error.message}`,
				error.response?.data
			);
		}
	}

	/**
	 * Fetch attachment content as base64 for MCP injection (supports all file types)
	 * @param {string} attachmentId - The attachment ID
	 * @param {Object} [options] - Additional options
	 * @param {Object} [options.log] - Logger object
	 * @param {boolean} [options.thumbnail=false] - Whether to fetch thumbnail instead of full content (images only)
	 * @param {boolean} [options.compress=true] - Whether to compress images for MCP injection
	 * @returns {Promise<Object>} - Result with success status and base64 data/error
	 */
	async fetchAttachmentAsBase64(attachmentId, options = {}) {
		const log = options.log || {
			info: () => {},
			warn: () => {},
			error: () => {},
			debug: () => {}
		};
		const thumbnail = options.thumbnail || false;
		const compress = options.compress !== undefined ? options.compress : true; // Default to compress

		try {
			if (!this.isReady()) {
				return this.createErrorResponse(
					'JIRA_NOT_ENABLED',
					'Jira integration is not properly configured'
				);
			}

			if (!attachmentId) {
				return this.createErrorResponse(
					'JIRA_INVALID_INPUT',
					'Attachment ID is required'
				);
			}

			log.info?.(
				`Fetching attachment ${attachmentId} as base64 (thumbnail: ${thumbnail}, compress: ${compress})`
			);

			const client = this.getClient();
			const endpoint = thumbnail
				? `/rest/api/3/attachment/thumbnail/${attachmentId}`
				: `/rest/api/3/attachment/content/${attachmentId}`;

			const response = await client.get(endpoint, {
				responseType: 'arraybuffer'
			});

			if (!response.data) {
				return this.createErrorResponse(
					'JIRA_INVALID_RESPONSE',
					'No attachment data received from Jira API'
				);
			}

			// Convert binary data to base64
			let base64Data = Buffer.from(response.data, 'binary').toString('base64');

			// Get MIME type from response headers
			let mimeType =
				response.headers['content-type'] || 'application/octet-stream';
			let originalSize = response.data.byteLength;
			let compressedSize = originalSize;

			// Apply compression if requested and it's an image
			if (compress && mimeType.startsWith('image/')) {
				log.info?.('Compressing image for MCP injection...');
				const compressionResult = await compressImageIfNeeded(
					base64Data,
					mimeType,
					log
				);
				base64Data = compressionResult.base64;
				mimeType = compressionResult.mimeType;
				compressedSize = compressionResult.compressedSize;

				log.info?.(
					`Image compression complete. Original: ${originalSize} bytes, Compressed: ${compressedSize} bytes`
				);
			}

			return {
				success: true,
				data: {
					base64: base64Data,
					mimeType: mimeType,
					size: compressedSize,
					originalSize: originalSize,
					attachmentId: attachmentId,
					isThumbnail: thumbnail,
					compressed:
						compress &&
						mimeType.startsWith('image/') &&
						compressedSize < originalSize
				}
			};
		} catch (error) {
			log.error?.(`Error fetching attachment as base64: ${error.message}`);
			return this.createErrorResponse(
				'JIRA_REQUEST_ERROR',
				`Failed to fetch attachment: ${error.message}`,
				error.response?.data
			);
		}
	}

	/**
	 * Fetch multiple attachments as base64 for MCP injection (supports all file types)
	 * @param {Array<string>} attachmentIds - Array of attachment IDs
	 * @param {Object} [options] - Additional options
	 * @param {Object} [options.log] - Logger object
	 * @param {boolean} [options.thumbnail=false] - Whether to fetch thumbnails instead of full content
	 * @param {boolean} [options.compress=true] - Whether to compress images for MCP injection
	 * @param {Array<string>} [options.imageTypes] - Array of MIME types to filter for images only (empty array = all types)
	 * @param {Array<Object>} [options.attachmentMetadata] - Array of attachment metadata objects with filename, etc.
	 * @param {boolean} [options.allFileTypes=false] - Whether to fetch all file types (not just images)
	 * @returns {Promise<Object>} - Result with success status and array of base64 data/error
	 */
	async fetchAttachmentsAsBase64(attachmentIds, options = {}) {
		const log = options.log || {
			info: () => {},
			warn: () => {},
			error: () => {},
			debug: () => {}
		};
		const thumbnail = options.thumbnail || false;
		const compress = options.compress !== undefined ? options.compress : true; // Default to compress
		const attachmentMetadata = options.attachmentMetadata || [];
		const allFileTypes = options.allFileTypes || false;

		// Default to image types for backward compatibility, unless allFileTypes is true
		const imageTypes = allFileTypes
			? []
			: options.imageTypes || [
					'image/jpeg',
					'image/jpg',
					'image/png',
					'image/gif',
					'image/bmp',
					'image/webp',
					'image/svg+xml'
				];

		try {
			if (!this.isReady()) {
				return this.createErrorResponse(
					'JIRA_NOT_ENABLED',
					'Jira integration is not properly configured'
				);
			}

			if (!Array.isArray(attachmentIds) || attachmentIds.length === 0) {
				return this.createErrorResponse(
					'JIRA_INVALID_INPUT',
					'Attachment IDs array is required and must not be empty'
				);
			}

			log.info?.(
				`Fetching ${attachmentIds.length} attachments as base64 (thumbnail: ${thumbnail}, compress: ${compress})`
			);

			const results = [];
			const errors = [];

			// Process attachments sequentially to avoid overwhelming the API
			for (const attachmentId of attachmentIds) {
				try {
					const result = await this.fetchAttachmentAsBase64(attachmentId, {
						log,
						thumbnail,
						compress
					});

					if (result.success) {
						// Filter based on file types (all types if allFileTypes=true or imageTypes is empty)
						const shouldInclude =
							allFileTypes ||
							imageTypes.length === 0 ||
							imageTypes.includes(result.data.mimeType);

						if (shouldInclude) {
							// Find metadata for this attachment and add filename if available
							const metadata = attachmentMetadata.find(
								(meta) => meta.id === attachmentId
							);
							if (metadata && metadata.filename) {
								result.data.filename = metadata.filename;
							}
							results.push(result.data);
						} else {
							log.info?.(
								`Skipping attachment ${attachmentId} with MIME type ${result.data.mimeType} (not in allowed types)`
							);
						}
					} else {
						errors.push({
							attachmentId,
							error: result.error
						});
					}
				} catch (error) {
					errors.push({
						attachmentId,
						error: {
							code: 'ATTACHMENT_FETCH_ERROR',
							message: error.message
						}
					});
				}
			}

			return {
				success: true,
				data: {
					attachments: results,
					errors: errors,
					totalRequested: attachmentIds.length,
					totalFetched: results.length,
					totalErrors: errors.length
				}
			};
		} catch (error) {
			log.error?.(
				`Error fetching multiple attachments as base64: ${error.message}`
			);
			return this.createErrorResponse(
				'JIRA_REQUEST_ERROR',
				`Failed to fetch attachments: ${error.message}`,
				error.response?.data
			);
		}
	}
}
