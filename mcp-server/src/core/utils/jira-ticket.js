/**
 * jira-ticket.js
 *
 * Class for managing Jira ticket data and converting between Task Master and Jira formats.
 * This class helps standardize Jira ticket operations by providing methods to:
 * 1. Convert markdown content to Atlassian Document Format (ADF)
 * 2. Format task data into proper Jira API request format
 * 3. Handle panel content formatting (details, acceptance criteria, test strategy)
 */

import { JiraClient } from './jira-client.js';

/**
 * Class representing a Jira ticket with conversion utilities
 */
export class JiraTicket {
	/**
	 * Create a new JiraTicket
	 * @param {Object} data - Initial ticket data
	 * @param {string} data.title - Ticket title/summary
	 * @param {string} data.description - Main ticket description
	 * @param {string} [data.details] - Implementation details
	 * @param {string} [data.acceptanceCriteria] - Acceptance criteria
	 * @param {string} [data.testStrategy] - Test strategy
	 * @param {string} [data.priority='Medium'] - Priority (High, Medium, Low)
	 * @param {string} [data.issueType='Task'] - Jira issue type (Epic, Story, Task, Bug, etc.)
	 * @param {string} [data.parentKey] - Parent issue key for subtasks
	 * @param {Array<string>} [data.labels=[]] - Labels to apply to the ticket
	 * @param {string} [data.assignee] - Assignee account ID
	 * @param {string} [data.jiraKey] - Existing Jira key (for updates)
	 * @param {string} [data.status] - Ticket status
	 * @param {Array<Object>} [data.attachments=[]] - Array of attachment objects
	 */
	constructor(data = {}) {
		this.title = data.title || '';
		this.description = data.description || '';
		this.details = data.details || '';
		this.acceptanceCriteria = data.acceptanceCriteria || '';
		this.testStrategy = data.testStrategy || '';
		this.priority = data.priority
			? data.priority.charAt(0).toUpperCase() + data.priority.slice(1)
			: 'Medium';
		this.issueType = data.issueType || 'Task';
		this.parentKey = data.parentKey || '';
		this.labels = data.labels || [];
		this.assignee = data.assignee || '';
		this.jiraKey = data.jiraKey || '';
		this.dependencies = data.dependencies || [];
		this.status = data.status || '';
		this.attachments = data.attachments || [];
	}

	/**
	 * Update multiple ticket properties at once
	 * @param {Object} data - Object containing properties to update
	 * @param {string} [data.title] - Ticket title/summary
	 * @param {string} [data.description] - Main ticket description in markdown format
	 * @param {string} [data.details] - Implementation details in markdown format
	 * @param {string} [data.acceptanceCriteria] - Acceptance criteria in markdown format
	 * @param {string} [data.testStrategy] - Test strategy in markdown format
	 * @param {string} [data.priority] - Priority (High, Medium, Low)
	 * @param {string} [data.issueType] - Jira issue type (Epic, Story, Task, Bug, etc.)
	 * @param {string} [data.parentKey] - Parent issue key for subtasks
	 * @param {Array<string>} [data.labels] - Labels to apply to the ticket
	 * @param {string} [data.assignee] - Assignee account ID
	 * @param {string} [data.jiraKey] - Existing Jira key (for updates)
	 * @param {Array<string>} [data.dependencies] - Array of issue keys this ticket depends on
	 * @param {string} [data.status] - Ticket status
	 * @returns {JiraTicket} - This instance for chaining
	 */
	update(data = {}) {
		if (data.title !== undefined) {
			this.title = data.title;
		}

		if (data.description !== undefined) {
			this.description = data.description;
		}

		if (
			data.details !== undefined ||
			data.implementationDetails !== undefined
		) {
			this.details = data.details || data.implementationDetails;
		}

		if (data.acceptanceCriteria !== undefined) {
			this.acceptanceCriteria = data.acceptanceCriteria;
		}

		if (data.testStrategy !== undefined || data.testStrategyTdd !== undefined) {
			this.testStrategy = data.testStrategy || data.testStrategyTdd;
		}

		if (data.priority !== undefined) {
			this.priority = data.priority
				? data.priority.charAt(0).toUpperCase() + data.priority.slice(1)
				: 'Medium';
		}

		if (data.issueType !== undefined) {
			this.issueType = data.issueType || 'Task';
		}

		if (data.parentKey !== undefined) {
			this.parentKey = data.parentKey;
		}

		if (data.labels !== undefined) {
			this.labels = Array.isArray(data.labels) ? data.labels : [];
		}

		if (data.assignee !== undefined) {
			this.assignee = data.assignee;
		}

		if (data.jiraKey !== undefined) {
			this.jiraKey = data.jiraKey;
		}

		if (data.dependencies !== undefined) {
			this.dependencies = Array.isArray(data.dependencies)
				? data.dependencies
				: [];
		}

		if (data.status !== undefined) {
			this.status = data.status;
		}

		if (data.attachments !== undefined) {
			this.attachments = Array.isArray(data.attachments)
				? data.attachments
				: [];
		}

		return this;
	}

	/**
	 * Add a single label
	 * @param {string} label - Label to add
	 * @returns {JiraTicket} - This instance for chaining
	 */
	addLabel(label) {
		if (label && !this.labels.includes(label)) {
			this.labels.push(label);
		}
		return this;
	}

	/**
	 * Add a single dependency
	 * @param {string} key - Issue key this ticket depends on
	 * @returns {JiraTicket} - This instance for chaining
	 */
	addDependency(key) {
		if (key && !this.dependencies.includes(key)) {
			this.dependencies.push(key);
		}
		return this;
	}

	/**
	 * Convert markdown text to Atlassian Document Format (ADF) nodes
	 * @param {string} text - Markdown text to convert
	 * @returns {Array} - Array of ADF nodes
	 * @private
	 */
	_convertMarkdownToAdf(text) {
		if (!text) return [];

		// Basic paragraph split by double newline
		const paragraphs = text.split(/\n\n+/);
		const nodes = [];

		paragraphs.forEach((paragraph) => {
			// Check for code block
			if (paragraph.startsWith('```') && paragraph.endsWith('```')) {
				// Extract language if specified after first ``` (e.g. ```javascript)
				let language = null;
				let content = paragraph.substring(3, paragraph.length - 3);

				const firstLineBreak = content.indexOf('\n');
				if (firstLineBreak > 0) {
					const possibleLang = content.substring(0, firstLineBreak).trim();
					if (possibleLang && !possibleLang.includes(' ')) {
						language = possibleLang;
						content = content.substring(firstLineBreak + 1);
					}
				}

				nodes.push({
					type: 'codeBlock',
					attrs: { language },
					content: [{ type: 'text', text: content.trim() }]
				});
			}
			// Check for heading
			else if (paragraph.startsWith('# ')) {
				nodes.push({
					type: 'heading',
					attrs: { level: 1 },
					content: [{ type: 'text', text: paragraph.substring(2).trim() }]
				});
			} else if (paragraph.startsWith('## ')) {
				nodes.push({
					type: 'heading',
					attrs: { level: 2 },
					content: [{ type: 'text', text: paragraph.substring(3).trim() }]
				});
			} else if (paragraph.startsWith('### ')) {
				nodes.push({
					type: 'heading',
					attrs: { level: 3 },
					content: [{ type: 'text', text: paragraph.substring(4).trim() }]
				});
			} else if (paragraph.startsWith('- ') || paragraph.startsWith('* ')) {
				// Simple bullet list
				const items = paragraph
					.split(/\n/)
					.filter(
						(line) =>
							line.trim().startsWith('- ') || line.trim().startsWith('* ')
					);
				const listItems = items.map((item) => {
					const content = item.replace(/^[-*]\s+/, '').trim();
					return {
						type: 'listItem',
						content: [
							{
								type: 'paragraph',
								content: this._parseInlineFormatting(content)
							}
						]
					};
				});

				nodes.push({
					type: 'bulletList',
					content: listItems
				});
			}
			// Check for ordered (numbered) list: 1. item, 2. item, etc.
			else if (/^\d+\.\s/.test(paragraph)) {
				const lines = paragraph.split(/\n/);
				const numberedItems = lines.filter((line) =>
					/^\d+\.\s/.test(line.trim())
				);

				if (numberedItems.length > 0) {
					const listItems = numberedItems.map((item) => {
						const content = item.replace(/^\d+\.\s+/, '').trim();
						return {
							type: 'listItem',
							content: [
								{
									type: 'paragraph',
									content: this._parseInlineFormatting(content)
								}
							]
						};
					});

					nodes.push({
						type: 'orderedList',
						content: listItems
					});
				} else {
					// Fall back to regular paragraph if no valid items
					nodes.push({
						type: 'paragraph',
						content: this._parseInlineFormatting(paragraph)
					});
				}
			} else {
				// Regular paragraph with potential inline formatting
				nodes.push({
					type: 'paragraph',
					content: this._parseInlineFormatting(paragraph)
				});
			}
		});

		return nodes;
	}

	/**
	 * Parse inline text formatting (bold, italic, code, links)
	 * @param {string} text - Text to parse for inline formatting
	 * @returns {Array} - Array of ADF text nodes with appropriate marks
	 * @private
	 */
	_parseInlineFormatting(text) {
		if (!text) return [{ type: 'text', text: '' }];

		// Simple patterns for inline formatting
		const elements = [];
		let remaining = text;

		// Process text for patterns
		while (remaining.length > 0) {
			// Bold: **text**
			const boldMatch = remaining.match(/^\*\*(.*?)\*\*/);
			if (boldMatch) {
				elements.push({
					type: 'text',
					marks: [{ type: 'strong' }],
					text: boldMatch[1]
				});
				remaining = remaining.substring(boldMatch[0].length);
				continue;
			}

			// Italic: *text*
			const italicMatch = remaining.match(/^\*(.*?)\*/);
			if (italicMatch) {
				elements.push({
					type: 'text',
					marks: [{ type: 'em' }],
					text: italicMatch[1]
				});
				remaining = remaining.substring(italicMatch[0].length);
				continue;
			}

			// Inline code: `code`
			const codeMatch = remaining.match(/^`(.*?)`/);
			if (codeMatch) {
				elements.push({
					type: 'text',
					marks: [{ type: 'code' }],
					text: codeMatch[1]
				});
				remaining = remaining.substring(codeMatch[0].length);
				continue;
			}

			// Link: [text](url)
			const linkMatch = remaining.match(/^\[(.*?)\]\((.*?)\)/);
			if (linkMatch) {
				elements.push({
					type: 'text',
					marks: [
						{
							type: 'link',
							attrs: {
								href: linkMatch[2],
								title: linkMatch[1]
							}
						}
					],
					text: linkMatch[1]
				});
				remaining = remaining.substring(linkMatch[0].length);
				continue;
			}

			// If no patterns match, take the next character as plain text
			const nextChar = remaining.charAt(0);

			// If we already have a text element, append to it
			if (
				elements.length > 0 &&
				elements[elements.length - 1].type === 'text' &&
				(!elements[elements.length - 1].marks ||
					elements[elements.length - 1].marks.length === 0)
			) {
				elements[elements.length - 1].text += nextChar;
			} else {
				elements.push({
					type: 'text',
					text: nextChar
				});
			}

			remaining = remaining.substring(1);
		}

		return elements.length > 0 ? elements : [{ type: 'text', text: text }];
	}

	/**
	 * Create a panel in ADF format
	 * @param {string} panelType - Panel type (info, note, success, warning, error)
	 * @param {string} title - Panel title
	 * @param {string} content - Panel content in markdown format
	 * @returns {Object} - ADF panel object
	 * @private
	 */
	_createPanel(panelType, title, content) {
		return {
			type: 'panel',
			attrs: { panelType },
			content: [
				{
					type: 'heading',
					attrs: { level: 2 },
					content: [{ type: 'text', text: title }]
				},
				...this._convertMarkdownToAdf(content)
			]
		};
	}

	/**
	 * Create the complete ADF document for the ticket description
	 * @returns {Object} - Complete ADF document object
	 */
	toADF() {
		const adf = {
			version: 1,
			type: 'doc',
			content: []
		};

		// Add main description
		if (this.description) {
			adf.content.push(...this._convertMarkdownToAdf(this.description));

			// Add a divider if we have more sections
			if (this.details || this.acceptanceCriteria || this.testStrategy) {
				adf.content.push({
					type: 'rule'
				});
			}
		}

		// Add Implementation Details section if available
		if (this.details) {
			adf.content.push(
				this._createPanel('info', 'Implementation Details', this.details)
			);
		}

		// Add Acceptance Criteria section if available
		if (this.acceptanceCriteria) {
			adf.content.push(
				this._createPanel(
					'success',
					'Acceptance Criteria',
					this.acceptanceCriteria
				)
			);
		}

		// Add Test Strategy section if available
		if (this.testStrategy) {
			adf.content.push(
				this._createPanel('note', 'Test Strategy (TDD)', this.testStrategy)
			);
		}

		return adf;
	}

	/**
	 * Create Jira API request data for creating/updating an issue
	 * @returns {Object} - Request data object for Jira API
	 */
	toJiraRequestData() {
		const config = JiraClient.getJiraConfig();
		const requestBody = {
			fields: {
				// Project is required
				project: {
					key: config.project
				},
				// Summary (title) of the issue
				summary: this.title,
				// Issue type
				issuetype: {
					name: this.issueType
				}
			}
		};

		// Add parent reference for subtasks or linking to epics
		if (this.parentKey) {
			requestBody.fields.parent = {
				key: this.parentKey
			};
		}

		// Add description if provided (using Atlassian Document Format for Jira API v3)
		if (this.description) {
			// Check if we have additional panels to include
			const hasAdditionalContent =
				this.details || this.acceptanceCriteria || this.testStrategy;

			// If we have additional content, always use toADF() to include all panels
			if (hasAdditionalContent) {
				requestBody.fields.description = this.toADF();
			} else {
				// Only if there's no additional content, do the simple conversion
				if (
					typeof this.description === 'object' &&
					this.description.type === 'doc'
				) {
					requestBody.fields.description = this.description;
				} else if (typeof this.description === 'string') {
					// If it's a simple string, convert to basic ADF format
					requestBody.fields.description = {
						type: 'doc',
						version: 1,
						content: [
							{
								type: 'paragraph',
								content: [
									{
										type: 'text',
										text: this.description
									}
								]
							}
						]
					};
				} else {
					// Fallback to toADF() for anything else
					requestBody.fields.description = this.toADF();
				}
			}
		}

		// Add optional fields if provided
		if (this.priority) {
			requestBody.fields.priority = {
				name: this.priority
			};
		}

		if (this.assignee) {
			requestBody.fields.assignee = {
				accountId: this.assignee
			};
		}

		if (this.labels && Array.isArray(this.labels) && this.labels.length > 0) {
			requestBody.fields.labels = this.labels;
		}

		return requestBody;
	}

	/**
	 * Create a Task Master task object from this Jira ticket
	 * @returns {Object} - Task object in Task Master format
	 */
	toTaskMasterFormat() {
		return {
			id: this.jiraKey || '',
			title: this.title,
			description: this.description,
			details: this.details,
			acceptanceCriteria: this.acceptanceCriteria,
			testStrategy: this.testStrategy,
			priority: JiraTicket.convertJiraPriorityToTaskMaster(this.priority),
			status: JiraTicket.convertJiraStatusToTaskMaster(this.status),
			dependencies: this.dependencies,
			jiraKey: this.jiraKey,
			parentKey: this.parentKey,
			attachments: this.attachments
		};
	}

	/**
	 * Extract panels from Jira description field
	 * @param {Object} description - Jira description object in Atlassian Document Format
	 * @returns {Object} - Object with extracted panel content
	 */
	static extractPanelsFromDescription(description) {
		if (!description || !description.content) {
			return {};
		}

		const result = {};

		// Find all panels in the description
		description.content.forEach((item) => {
			if (item.type === 'panel') {
				// Extract the panel heading (title)
				const headingNode = item.content.find(
					(node) =>
						node.type === 'heading' &&
						node.content &&
						node.content[0] &&
						node.content[0].type === 'text'
				);

				if (headingNode) {
					const panelTitle = headingNode.content[0].text;
					let panelKey = JiraTicket.convertToCamelCase(panelTitle);

					// Extract panel content (everything except the heading)
					const contentNodes = item.content.filter(
						(node) => node.type !== 'heading'
					);
					const extractedContent =
						JiraTicket.extractTextFromNodes(contentNodes);

					// Add to result object
					result[panelKey] = extractedContent.trim();
				}
			}
		});

		return result;
	}

	/**
	 * Extract text content from ADF nodes recursively
	 * @param {Array} nodes - Array of ADF nodes
	 * @returns {string} - Extracted text content
	 */
	static extractTextFromNodes(nodes) {
		if (!nodes || !Array.isArray(nodes)) {
			return '';
		}

		return nodes
			.map((node) => {
				// Direct text node
				if (node.type === 'text') {
					// Handle marks for inline formatting
					if (node.marks && node.marks.length > 0) {
						const hasCode = node.marks.some((mark) => mark.type === 'code');
						if (hasCode) {
							// For inline code, wrap with backticks
							return `\`${node.text}\``;
						}
					}
					return node.text;
				}

				// Code block
				if (node.type === 'codeBlock') {
					// Format as code block with triple backticks
					return `\`\`\`\n${node.content ? JiraTicket.extractTextFromNodes(node.content) : ''}\n\`\`\``;
				}

				// Paragraph node - extract text and add newline
				if (node.type === 'paragraph') {
					return JiraTicket.extractTextFromNodes(node.content) + '\n';
				}

				// List item node - extract text, add bullet or number and newline
				if (node.type === 'listItem') {
					return '- ' + JiraTicket.extractTextFromNodes(node.content);
				}

				// Ordered list - extract with numbers
				if (node.type === 'orderedList') {
					return node.content
						.map((item, index) => {
							const itemContent = JiraTicket.extractTextFromNodes([item]);
							return `${index + 1}. ${itemContent.replace(/^- /, '')}`;
						})
						.join('\n');
				}

				// Bullet list - extract with bullets
				if (node.type === 'bulletList') {
					return node.content
						.map((item) => {
							const itemContent = JiraTicket.extractTextFromNodes([item]);
							return itemContent; // listItem already adds bullet
						})
						.join('\n');
				}

				// Handle heading nodes
				if (node.type === 'heading') {
					const level = node.attrs?.level || 1;
					const headingText = JiraTicket.extractTextFromNodes(node.content);
					// Add # characters based on heading level
					return '#'.repeat(level) + ' ' + headingText + '\n';
				}

				// Other nodes with content - recurse
				if (node.content && Array.isArray(node.content)) {
					return JiraTicket.extractTextFromNodes(node.content);
				}

				return '';
			})
			.join('');
	}

	/**
	 * Extract plain text description from Jira description field (first paragraph only)
	 * @param {Object} description - Jira description object in Atlassian Document Format
	 * @returns {string} - Plain text description
	 */
	static extractPlainTextDescription(description) {
		if (!description || !description.content) {
			return 'No description';
		}

		// Find first paragraph or text content
		for (const item of description.content) {
			if (item.type === 'paragraph' || (item.type === 'text' && item.text)) {
				const text = JiraTicket.extractTextFromNodes([item]).trim();
				if (text) {
					return text;
				}
			}
		}

		// If no paragraphs found, extract from the whole content
		return (
			JiraTicket.extractTextFromNodes(description.content).split('\n')[0] ||
			'No description'
		);
	}

	/**
	 * Convert a string to camelCase
	 * @param {string} str - String to convert
	 * @returns {string} - camelCase string
	 */
	static convertToCamelCase(str) {
		// Remove special characters and replace with spaces
		const cleaned = str.replace(/[^\w\s]/g, ' ');

		// Split by space, capitalize first letter of each word except first, join
		return cleaned
			.split(/\s+/)
			.map((word, index) => {
				if (index === 0) {
					return word.toLowerCase();
				}
				return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
			})
			.join('');
	}

	/**
	 * Convert Jira priority to Task Master format
	 * @param {string} jiraPriority - Priority from Jira
	 * @returns {string} - Priority in Task Master format
	 */
	static convertJiraPriorityToTaskMaster(jiraPriority) {
		const priorityMapping = {
			Highest: 'high',
			High: 'high',
			Medium: 'medium',
			Low: 'low',
			Lowest: 'low'
		};

		return priorityMapping[jiraPriority] || 'medium';
	}

	/**
	 * Convert Jira status to Task Master format
	 * @param {string} jiraStatus - Status from Jira
	 * @returns {string} - Status in Task Master format
	 */
	static convertJiraStatusToTaskMaster(jiraStatus) {
		const statusMapping = {
			'To Do': 'pending',
			'In Progress': 'in-progress',
			Done: 'done',
			Blocked: 'blocked',
			Deferred: 'deferred',
			Cancelled: 'cancelled'
		};

		return statusMapping[jiraStatus] || 'pending';
	}

	/**
	 * Create a JiraTicket instance from an existing Task Master task object
	 * @param {Object} task - Task object in Task Master format
	 * @returns {JiraTicket} - New JiraTicket instance
	 */
	static fromTaskMaster(task) {
		return new JiraTicket({
			title: task.title,
			description: task.description,
			details: task.details,
			acceptanceCriteria: task.acceptanceCriteria,
			testStrategy: task.testStrategy,
			priority: task.priority
				? task.priority.charAt(0).toUpperCase() + task.priority.slice(1)
				: 'Medium',
			jiraKey: task.jiraKey,
			dependencies: task.dependencies
		});
	}

	/**
	 * Create a JiraTicket instance from a Jira API response
	 * @param {Object} jiraIssue - Jira issue data from API
	 * @returns {JiraTicket} - New JiraTicket instance
	 */
	static async fromJiraIssue(jiraIssue) {
		// Import necessary functions from jira-utils.js
		// Using the existing functions directly from the imported module
		// No need to redefine them here

		// Extract panel content from description if available
		let panelData = {};
		if (jiraIssue.fields?.description) {
			try {
				// Use the extraction function from jira-utils module
				panelData = JiraTicket.extractPanelsFromDescription(
					jiraIssue.fields.description
				);
			} catch (error) {
				console.warn(
					`Error extracting panels from Jira issue description: ${error.message}`
				);
			}
		}

		// Extract dependencies from issuelinks
		const dependencies = [];
		if (
			jiraIssue.fields?.issuelinks &&
			jiraIssue.fields.issuelinks.length > 0
		) {
			jiraIssue.fields.issuelinks.forEach((link) => {
				if (link.inwardIssue) {
					dependencies.push(link.inwardIssue.key);
				}
			});
		}

		// Extract description text if available
		let description = 'No description';
		if (jiraIssue.fields?.description) {
			try {
				description =
					JiraTicket.extractPlainTextDescription(
						jiraIssue.fields.description
					) || 'No description';
			} catch (error) {
				console.warn(
					`Error extracting plain text description: ${error.message}`
				);
			}
		}

		// Create the initial ticket with standard fields
		const ticket = new JiraTicket({
			title: jiraIssue.fields?.summary || '',
			description: description,
			priority: jiraIssue.fields?.priority?.name || 'Medium',
			issueType: jiraIssue.fields?.issuetype?.name || 'Task',
			jiraKey: jiraIssue.key,
			status: jiraIssue.fields?.status?.name || '',
			dependencies: dependencies,
			labels: jiraIssue.fields?.labels || [],
			attachments: jiraIssue.fields?.attachment || []
		});

		// Update ticket with panel data if available
		// This might include details, acceptanceCriteria, testStrategy, etc.
		if (Object.keys(panelData).length > 0) {
			ticket.update(panelData);
		}

		// Set parent key if this is a subtask
		if (jiraIssue.fields?.parent) {
			ticket.update({
				parentKey: jiraIssue.fields.parent.key
			});
		}

		// Set assignee if available
		if (jiraIssue.fields?.assignee) {
			ticket.update({
				assignee: jiraIssue.fields.assignee.accountId
			});
		}

		return ticket;
	}
}
