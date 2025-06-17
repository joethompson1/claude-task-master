/**
 * tools/get-jira-attachment.js
 * Tool to get Jira attachments with automatic file type detection and text extraction
 *
 * Supports all file types:
 * - Images: Returned as base64 for display in chat
 * - Documents (PDF, DOCX, XLSX): Text content extracted and returned
 * - Code files: Source code content extracted and returned
 * - Other text files: Plain text content extracted and returned
 */

import { z } from 'zod';
import { handleApiResult, createErrorResponse } from './utils.js';
import { JiraClient } from '../core/utils/jira-client.js';
import {
	enableSilentMode,
	disableSilentMode
} from '../../../scripts/modules/utils.js';

/**
 * Register the get-jira-attachment tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerGetJiraAttachmentTool(server) {
	server.addTool({
		name: 'get_jira_attachment',
		description:
			'Get Jira attachments with automatic file type detection and text extraction. Images return as base64, documents/code files return extracted text content.',
		parameters: z.object({
			ticketId: z
				.string()
				.describe(
					'The Jira ticket ID to fetch attachments from (e.g., PROJ-123). Required if attachmentId is not provided.'
				),
			attachmentId: z
				.string()
				.optional()
				.describe(
					'The specific attachment ID to fetch. If provided, only this attachment will be fetched.'
				),
			thumbnail: z
				.boolean()
				.optional()
				.default(false)
				.describe(
					'Whether to fetch thumbnails instead of full images (images only)'
				),
			fileTypes: z
				.array(z.string())
				.optional()
				.describe(
					'Filter attachments by file types: "image", "document", "code", "text". If not specified, all supported types are included.'
				),
			imagesOnly: z
				.boolean()
				.optional()
				.default(false)
				.describe('Legacy compatibility: if true, only fetch image attachments')
		}),
		execute: async (args, { log, session }) => {
			try {
				const {
					ticketId,
					attachmentId,
					thumbnail = false,
					fileTypes,
					imagesOnly = false
				} = args;

				if (!ticketId && !attachmentId) {
					return createErrorResponse(
						'Either ticketId or attachmentId must be provided'
					);
				}

				log.info(
					`Getting Jira attachments from ticket: ${ticketId} (thumbnail: ${thumbnail}, types: ${fileTypes ? fileTypes.join(',') : 'all'})`
				);

				// Enable silent mode to prevent console logs from interfering with JSON response
				enableSilentMode();

				try {
					// Create a silent logger to prevent console output that breaks MCP JSON protocol
					const silentLog = {
						info: () => {},
						warn: () => {},
						error: () => {},
						debug: () => {}
					};

					const jiraClient = new JiraClient();
					if (!jiraClient.isReady()) {
						return createErrorResponse(
							'Jira integration is not properly configured'
						);
					}

					// Get ticket details to fetch attachments
					log.info(`Fetching attachment metadata for issue: ${ticketId}`);
					const issueResult = await jiraClient.fetchIssue(ticketId, {
						log: silentLog
					});

					if (!issueResult.success) {
						return createErrorResponse(
							`Failed to fetch Jira ticket ${ticketId}: ${issueResult.error?.message || 'Unknown error'}`
						);
					}

					const issue = issueResult.data;

					if (!issue || !issue.attachments || issue.attachments.length === 0) {
						return {
							content: [
								{
									type: 'text',
									text: `Jira ticket ${ticketId} has no attachments`
								}
							]
						};
					}

					let attachmentsToProcess = issue.attachments;

					// Filter by specific attachment ID if provided
					if (attachmentId) {
						attachmentsToProcess = attachmentsToProcess.filter(
							(att) => att.id === attachmentId
						);
						if (attachmentsToProcess.length === 0) {
							return createErrorResponse(
								`Attachment ${attachmentId} not found in ticket ${ticketId}`
							);
						}
					}

					// Filter by file types if specified
					if (imagesOnly) {
						attachmentsToProcess = attachmentsToProcess.filter(
							(att) => att.mimeType && att.mimeType.startsWith('image/')
						);
					} else if (fileTypes && fileTypes.length > 0) {
						attachmentsToProcess = attachmentsToProcess.filter((att) => {
							const type = detectFileType(att.mimeType, att.filename);
							return fileTypes.includes(type);
						});
					}

					if (attachmentsToProcess.length === 0) {
						return {
							content: [
								{
									type: 'text',
									text: `No matching attachments found in ticket ${ticketId}`
								}
							]
						};
					}

					log.info(
						`Processing ${attachmentsToProcess.length} attachment(s)...`
					);

					const content = [];
					const errors = [];

					// Add summary header
					content.push({
						type: 'text',
						text: `Found ${attachmentsToProcess.length} attachment(s) in Jira ticket ${ticketId}:`
					});

					// Process each attachment
					for (let i = 0; i < attachmentsToProcess.length; i++) {
						const attachment = attachmentsToProcess[i];
						log.info(
							`Processing attachment ${i + 1}/${attachmentsToProcess.length}: ${attachment.filename}`
						);

						try {
							const result = await processAttachment(
								attachment,
								jiraClient,
								{ thumbnail },
								log,
								silentLog
							);

							if (result.success) {
								// Add attachment info
								content.push({
									type: 'text',
									text: `\nAttachment ${i + 1}: ${result.filename} (${result.mimeType}, ${Math.round(result.size / 1024)}KB)`
								});

								// Add content based on type
								if (result.contentType === 'image') {
									content.push({
										type: 'image',
										data: result.base64,
										mimeType: result.mimeType
									});
								} else if (result.contentType === 'text') {
									content.push({
										type: 'text',
										text: `--- File Content ---\n${result.content}`
									});
								}
							} else {
								errors.push({
									filename: attachment.filename,
									error: result.error
								});
							}
						} catch (error) {
							log.error(
								`Error processing attachment ${attachment.filename}: ${error.message}`
							);
							errors.push({
								filename: attachment.filename,
								error: error.message
							});
						}
					}

					// Add error summary if needed
					if (errors.length > 0) {
						content.push({
							type: 'text',
							text: `\n--- Processing Errors ---`
						});
						errors.forEach((error, index) => {
							content.push({
								type: 'text',
								text: `Error ${index + 1}: ${error.filename} - ${error.error}`
							});
						});
					}

					// Restore normal logging before returning
					disableSilentMode();

					return { content };
				} catch (error) {
					// Make sure to restore normal logging even if there's an error
					disableSilentMode();

					log.error(`Error in get_jira_attachment: ${error.message}`);
					return createErrorResponse(
						`Failed to get Jira attachments: ${error.message}`
					);
				}
			} catch (error) {
				log.error(`Error in get_jira_attachment: ${error.message}`);
				return createErrorResponse(
					`Failed to get Jira attachments: ${error.message}`
				);
			}
		}
	});
}

// Simple file type detection
function detectFileType(mimeType, filename) {
	if (mimeType && mimeType.startsWith('image/')) return 'image';

	const documentTypes = [
		'application/pdf',
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		'application/vnd.ms-excel',
		'application/msword'
	];
	if (documentTypes.includes(mimeType)) return 'document';

	if (mimeType && mimeType.startsWith('text/')) return 'code';

	if (filename) {
		const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
		const codeExts = [
			'.js',
			'.ts',
			'.py',
			'.java',
			'.html',
			'.css',
			'.json',
			'.md',
			'.txt'
		];
		if (codeExts.includes(ext)) return 'code';
	}

	return 'other';
}

// Process a single attachment
async function processAttachment(
	attachment,
	jiraClient,
	options,
	log,
	silentLog
) {
	try {
		log.info(
			`Processing attachment: ${attachment.filename} (${attachment.mimeType})`
		);

		// Download the attachment
		log.info(`Downloading attachment: ${attachment.id}`);

		const downloadResult = await jiraClient.fetchAttachmentAsBase64(
			attachment.id,
			{
				log: silentLog,
				thumbnail: options.thumbnail || false,
				compress: false
			}
		);

		if (!downloadResult.success) {
			return {
				success: false,
				error: `Download failed: ${downloadResult.error?.message || 'Unknown error'}`
			};
		}

		const fileType = detectFileType(attachment.mimeType, attachment.filename);

		// Handle images
		if (fileType === 'image') {
			return {
				success: true,
				filename: attachment.filename,
				mimeType: attachment.mimeType,
				size: attachment.size,
				contentType: 'image',
				base64: downloadResult.data.base64
			};
		}

		// Handle text/document files
		if (fileType === 'document' || fileType === 'code') {
			const buffer = Buffer.from(downloadResult.data.base64, 'base64');
			const textResult = await extractText(
				buffer,
				attachment.mimeType,
				attachment.filename,
				silentLog
			);

			return {
				success: true,
				filename: attachment.filename,
				mimeType: attachment.mimeType,
				size: attachment.size,
				contentType: 'text',
				content:
					textResult.text ||
					`[Could not extract text: ${textResult.error || 'Unknown error'}]`
			};
		}

		return {
			success: false,
			error: `Unsupported file type: ${fileType}`
		};
	} catch (error) {
		log.error(`Attachment processing failed: ${error.message}`);
		return {
			success: false,
			error: error.message
		};
	}
}

// Simple text extraction
async function extractText(buffer, mimeType, filename, log) {
	// Helper function to suppress console output from external libraries
	const suppressConsoleOutput = async (fn) => {
		const originalConsole = {
			log: console.log,
			warn: console.warn,
			error: console.error,
			info: console.info,
			debug: console.debug
		};

		// Suppress all console output
		console.log = () => {};
		console.warn = () => {};
		console.error = () => {};
		console.info = () => {};
		console.debug = () => {};

		try {
			return await fn();
		} finally {
			// Restore original console methods
			console.log = originalConsole.log;
			console.warn = originalConsole.warn;
			console.error = originalConsole.error;
			console.info = originalConsole.info;
			console.debug = originalConsole.debug;
		}
	};

	try {
		// PDF files
		if (mimeType === 'application/pdf') {
			try {
				return await suppressConsoleOutput(async () => {
					const unpdf = await import('unpdf');
					const uint8Array = new Uint8Array(buffer);
					const result = await unpdf.extractText(uint8Array);
					return { text: result?.text || result || '' };
				});
			} catch (error) {
				return { error: `PDF extraction failed: ${error.message}` };
			}
		}

		// DOCX files
		if (
			mimeType ===
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
		) {
			try {
				return await suppressConsoleOutput(async () => {
					const mammoth = await import('mammoth');
					const result = await mammoth.default.extractRawText({ buffer });
					return { text: result.value };
				});
			} catch (error) {
				return { error: `DOCX extraction failed: ${error.message}` };
			}
		}

		// Excel files
		if (
			mimeType ===
				'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
			mimeType === 'application/vnd.ms-excel'
		) {
			try {
				return await suppressConsoleOutput(async () => {
					const XLSX = await import('xlsx');
					const workbook = XLSX.read(buffer, { type: 'buffer' });
					const sheets = [];

					workbook.SheetNames.forEach((sheetName) => {
						const worksheet = workbook.Sheets[sheetName];
						const sheetData = XLSX.utils.sheet_to_json(worksheet, {
							header: 1,
							defval: ''
						});
						const sheetText = sheetData
							.filter((row) => row.some((cell) => cell !== ''))
							.map((row) => row.join('\t'))
							.join('\n');
						if (sheetText.trim()) {
							sheets.push(`=== Sheet: ${sheetName} ===\n${sheetText}`);
						}
					});

					return { text: sheets.join('\n\n') };
				});
			} catch (error) {
				return { error: `Excel extraction failed: ${error.message}` };
			}
		}

		// Text/code files
		if ((mimeType && mimeType.startsWith('text/')) || isCodeFile(filename)) {
			try {
				return await suppressConsoleOutput(async () => {
					const iconv = await import('iconv-lite');
					let text;
					try {
						text = iconv.default.decode(buffer, 'utf8');
						if (text.includes('')) throw new Error('Invalid UTF-8');
					} catch {
						text = iconv.default.decode(buffer, 'latin1');
					}
					return { text };
				});
			} catch (error) {
				return { error: `Text extraction failed: ${error.message}` };
			}
		}

		return { error: 'Unsupported file type for text extraction' };
	} catch (error) {
		return { error: `Extraction failed: ${error.message}` };
	}
}

// Check if file is a code file
function isCodeFile(filename) {
	const codeExts = [
		'.js',
		'.ts',
		'.py',
		'.java',
		'.html',
		'.css',
		'.json',
		'.md',
		'.txt',
		'.log'
	];
	const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
	return codeExts.includes(ext);
}
