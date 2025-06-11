/**
 * tools/get-jira-image-attachment.js
 * Tool to get Jira image attachments as base64 for image injection into the chat
 */

import { z } from 'zod';
import { JiraClient } from '../core/utils/jira-client.js';

/**
 * Register the get-jira-image-attachment tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerGetJiraImageAttachmentTool(server) {
	// Only register this tool if Jira is enabled
	if (JiraClient.isJiraEnabled()) {
		server.addTool({
			name: 'get_jira_image_attachment',
			description: 'Get Jira image attachments as base64 for image injection into the chat. Can fetch all images from a ticket or a specific image by attachment ID.',
			parameters: z.object({
				ticketId: z
					.string()
					.optional()
					.describe('The Jira ticket ID to fetch image attachments from (e.g., PROJ-123). Required if imageId is not provided.'),
				imageId: z
					.string()
					.optional()
					.describe('The specific attachment ID to fetch. If provided, only this attachment will be fetched.'),
				thumbnail: z
					.boolean()
					.optional()
					.default(false)
					.describe('Whether to fetch thumbnails instead of full images')
			}),
			execute: async (args, { log }) => {
				const { ticketId, imageId, thumbnail } = args;

				try {
					// Validate that at least one of ticketId or imageId is provided
					if (!ticketId && !imageId) {
						return {
							content: [
								{
									type: 'text',
									text: 'Either ticketId or imageId must be provided'
								}
							]
						};
					}

					// Create Jira client instance
					const jiraClient = new JiraClient();
					if (!jiraClient.isReady()) {
						return {
							content: [
								{
									type: 'text',
									text: 'Jira integration is not properly configured'
								}
							]
						};
					}

					// If imageId is provided, fetch only that specific attachment
					if (imageId) {
						log.info(`Getting specific Jira image attachment: ${imageId} (thumbnail: ${thumbnail})`);

						const attachmentResult = await jiraClient.fetchAttachmentAsBase64(imageId, {
							log,
							thumbnail,
							compress: true
						});

						if (!attachmentResult.success) {
							return {
								content: [
									{
										type: 'text',
										text: `Failed to fetch attachment ${imageId}: ${attachmentResult.error?.message || 'Unknown error'}`
									}
								]
							};
						}

						const imageData = attachmentResult.data;

						// Check if it's actually an image
						if (!imageData.mimeType || !imageData.mimeType.startsWith('image/')) {
							return {
								content: [
									{
										type: 'text',
										text: `Attachment ${imageId} is not an image (MIME type: ${imageData.mimeType})`
									}
								]
							};
						}

						// Return the single image
						const content = [
							{
								type: 'text',
								text: `Image attachment ${imageId}: ${imageData.filename || 'Unknown filename'} (${imageData.mimeType}, ${Math.round(imageData.size / 1024)}KB${imageData.isThumbnail ? ', thumbnail' : ''})`
							},
							{
								type: 'image',
								data: imageData.base64,
								mimeType: imageData.mimeType
							}
						];

						log.info(`Successfully retrieved image attachment ${imageId}`);
						return { content };
					}

					// Original behavior: fetch all images from a ticket
					log.info(
						`Getting all Jira image attachments from ticket: ${ticketId} (thumbnail: ${thumbnail})`
					);

					// Fetch the Jira ticket - this automatically fetches all image attachments as base64
					const ticketResult = await jiraClient.fetchIssue(ticketId, { log });

					if (!ticketResult.success) {
						return {
							content: [
								{
									type: 'text',
									text: `Failed to fetch Jira ticket ${ticketId}: ${ticketResult.error?.message || 'Unknown error'}`
								}
							]
						};
					}

					const jiraTicket = ticketResult.data;

					// Check if the ticket has any attachments
					if (!jiraTicket.attachments || jiraTicket.attachments.length === 0) {
						return {
							content: [
								{
									type: 'text',
									text: `Jira ticket ${ticketId} has no attachments`
								}
							]
						};
					}

					// Filter for image attachments only
					const imageAttachments = jiraTicket.attachments.filter(att => 
						att.mimeType && att.mimeType.startsWith('image/')
					);

					if (imageAttachments.length === 0) {
						return {
							content: [
								{
									type: 'text',
									text: `Jira ticket ${ticketId} has ${jiraTicket.attachments.length} attachment(s) but none are images`
								}
							]
						};
					}

					// Check if we have the base64 image data (automatically fetched by fetchIssue)
					if (!jiraTicket.attachmentImages || jiraTicket.attachmentImages.length === 0) {
						log.warn('No base64 image data found, fetching images manually...');
						
						// Fallback: manually fetch images if not already available
						const attachmentIds = imageAttachments.map(att => att.id);
						const attachmentsResult = await jiraClient.fetchAttachmentsAsBase64(attachmentIds, {
							log,
							thumbnail,
							compress: true,
							imageTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/webp', 'image/svg+xml'],
							attachmentMetadata: imageAttachments
						});

						if (!attachmentsResult.success) {
							return {
								content: [
									{
										type: 'text',
										text: `Failed to fetch image attachments: ${attachmentsResult.error?.message || 'Unknown error'}`
									}
								]
							};
						}

						// Use the manually fetched images
						jiraTicket.attachmentImages = attachmentsResult.data.attachments;
					}

					// If thumbnail was requested but we have full images, fetch thumbnails
					if (thumbnail && jiraTicket.attachmentImageStats && !jiraTicket.attachmentImageStats.isThumbnail) {
						log.info('Thumbnail requested, fetching thumbnail versions...');
						const attachmentIds = imageAttachments.map(att => att.id);
						const thumbnailResult = await jiraClient.fetchAttachmentsAsBase64(attachmentIds, {
							log,
							thumbnail: true,
							compress: true,
							imageTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/webp', 'image/svg+xml'],
							attachmentMetadata: imageAttachments
						});

						if (thumbnailResult.success) {
							jiraTicket.attachmentImages = thumbnailResult.data.attachments;
						}
					}

					// Prepare the content array with all images
					const content = [];

					// Add a summary text first
					content.push({
						type: 'text',
						text: `Found ${jiraTicket.attachmentImages.length} image attachment(s) in Jira ticket ${ticketId}:`
					});

					// Add each image to the content array
					for (let i = 0; i < jiraTicket.attachmentImages.length; i++) {
						const imageData = jiraTicket.attachmentImages[i];
						
						// Add image description - filename should now be directly on imageData
						content.push({
							type: 'text',
							text: `Image ${i + 1}: ${imageData.filename || 'Unknown filename'} (${imageData.mimeType}, ${Math.round(imageData.size / 1024)}KB${imageData.isThumbnail ? ', thumbnail' : ''})`
						});

						// Add the actual image
						content.push({
							type: 'image',
							data: imageData.base64,
							mimeType: imageData.mimeType
						});
					}

					log.info(
						`Successfully retrieved ${jiraTicket.attachmentImages.length} image attachment(s) from ticket ${ticketId}`
					);

					return { content };

				} catch (error) {
					log.error(
						`Error in get-jira-image-attachment tool: ${error.message}`
					);
					return {
						content: [
							{
								type: 'text',
								text: `Failed to get image attachments: ${error.message}`
							}
						]
					};
				}
			}
		});
	}
} 