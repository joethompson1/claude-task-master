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
		this.relatedContext = data.relatedContext || null;
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

		if (data.relatedContext !== undefined) {
			this.relatedContext = data.relatedContext;
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
	 * Add context information to the ticket
	 * @param {Object} context - Context data to add
	 * @returns {JiraTicket} - This instance for chaining
	 */
	addContext(context) {
		if (context) {
			this.relatedContext = context;
		}
		return this;
	}

	/**
	 * Format context for MCP tool responses
	 * @returns {Object|null} - Formatted context or null if no context
	 */
	getFormattedContext() {
		if (!this.relatedContext) {
			return null;
		}

		return {
			summary: this.relatedContext.summary,
			relatedTickets: this.relatedContext.tickets.map(item => ({
				key: item.ticket.key,
				title: item.ticket.title,
				status: item.ticket.status,
				relationship: item.relationship,
				relevanceScore: item.relevanceScore,
				pullRequestCount: item.pullRequests?.length || 0,
				hasImplementation: item.pullRequests?.some(pr => pr.status === 'MERGED') || false
			})),
			implementationDetails: this.relatedContext.tickets
				.filter(item => item.pullRequests?.length > 0)
				.map(item => ({
					ticketKey: item.ticket.key,
					pullRequests: item.pullRequests.map(pr => ({
						title: pr.title,
						status: pr.status,
						url: pr.url,
						filesChanged: pr.filesChanged,
						mergedDate: pr.mergedDate
					}))
				}))
		};
	}

	/**
	 * Normalize markdown content to ensure consistent formatting
	 * @param {string} text - Raw markdown text
	 * @returns {string} - Normalized markdown text
	 * @private
	 */
	_normalizeMarkdown(text) {
		if (!text) return '';

		// Remove excessive whitespace and normalize line breaks
		let normalized = text.trim();

		// Normalize line endings to \n
		normalized = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

		// Remove trailing spaces from lines
		normalized = normalized.replace(/[ \t]+$/gm, '');

		// Normalize multiple empty lines to single empty line, but preserve necessary line breaks
		normalized = normalized.replace(/\n{3,}/g, '\n\n');

		// Fix critical markdown formatting issues with minimal changes
		// Ensure proper spacing around headers - but only if they're malformed
		normalized = normalized.replace(/^(#{1,6})([^#\s])/gm, '$1 $2');

		// Fix bold/italic formatting - remove extra spaces WITHIN the marks (but be careful)
		normalized = normalized.replace(/\*\*\s+([^*]+?)\s+\*\*/g, '**$1**');
		normalized = normalized.replace(/\*\s+([^*]+?)\s+\*/g, '*$1*');

		// Fix inline code formatting - remove extra spaces WITHIN backticks
		normalized = normalized.replace(/`\s+([^`]+?)\s+`/g, '`$1`');

		// Only fix critical code block issues - be very conservative
		// Fix cases where content is concatenated with closing ``` (but preserve language identifiers)
		normalized = normalized.replace(/([^`\n\s])```$/gm, '$1\n```');

		// Fix cases where closing ``` is immediately followed by content that should be on new line
		normalized = normalized.replace(/```([A-Z#])/g, '```\n$1');

		// Ensure code blocks have line breaks around them
		normalized = normalized.replace(/([^\n])```([a-z]*)/g, '$1\n```$2');
		normalized = normalized.replace(/```$/gm, '```\n');

		return normalized;
	}

	/**
	 * Enhanced markdown to ADF conversion with better error handling
	 * @param {string} text - Markdown text to convert
	 * @returns {Array} - Array of ADF nodes
	 * @private
	 */
	_convertMarkdownToAdf(text) {
		if (!text) return [];

		// Normalize the markdown first to ensure consistent formatting
		const normalizedText = this._normalizeMarkdown(text);

		try {
			return this._parseMarkdownToNodes(normalizedText);
		} catch (error) {
			// Fallback: if parsing fails, treat the entire text as a simple paragraph
			console.warn(
				'Markdown parsing failed, falling back to plain text:',
				error.message
			);
			return [
				{
					type: 'paragraph',
					content: [{ type: 'text', text: normalizedText }]
				}
			];
		}
	}

	/**
	 * Parse normalized markdown into ADF nodes using a simplified, more reliable approach
	 * @param {string} text - Normalized markdown text
	 * @returns {Array} - Array of ADF nodes
	 * @private
	 */
	_parseMarkdownToNodes(text) {
		const nodes = [];
		const lines = text.split('\n');
		let i = 0;

		while (i < lines.length) {
			const line = lines[i];

			// Skip empty lines
			if (!line.trim()) {
				i++;
				continue;
			}

			// Check for code block
			if (line.trim().startsWith('```')) {
				const language = line.trim().substring(3).trim();
				const codeLines = [];
				i++; // Move past opening line

				// Collect code block content
				while (i < lines.length) {
					const currentLine = lines[i];

					// Check if this line contains closing backticks
					if (currentLine.includes('```')) {
						// Handle cases where closing ``` might have content after it
						const beforeClosing = currentLine.substring(
							0,
							currentLine.indexOf('```')
						);
						if (beforeClosing.trim()) {
							codeLines.push(beforeClosing);
						}
						i++; // Skip this closing line
						break;
					} else {
						codeLines.push(currentLine);
						i++;
					}
				}

				// Create proper ADF codeBlock node
				const codeBlockNode = {
					type: 'codeBlock',
					content: [{ type: 'text', text: codeLines.join('\n') }]
				};

				// Only add language attribute if it's not empty - Jira is sensitive to empty/null attrs
				if (language && language.length > 0) {
					codeBlockNode.attrs = { language: language };
				}

				nodes.push(codeBlockNode);
				continue;
			}

			// Check for heading
			const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
			if (headingMatch) {
				const level = Math.min(headingMatch[1].length, 6);
				const content = headingMatch[2].trim();

				nodes.push({
					type: 'heading',
					attrs: { level },
					content: [{ type: 'text', text: content }]
				});
				i++;
				continue;
			}

			// Check for list
			if (/^\s*[-*+]\s/.test(line) || /^\s*\d+\.\s/.test(line)) {
				const listLines = [];
				while (
					i < lines.length &&
					(/^\s*[-*+]\s/.test(lines[i]) || /^\s*\d+\.\s/.test(lines[i]))
				) {
					listLines.push(lines[i]);
					i++;
				}

				const isOrdered = /^\s*\d+\.\s/.test(listLines[0]);
				const listItems = listLines.map((listLine) => {
					const content = isOrdered
						? listLine.trim().replace(/^\d+\.\s+/, '')
						: listLine.trim().replace(/^[-*+]\s+/, '');

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
					type: isOrdered ? 'orderedList' : 'bulletList',
					content: listItems
				});
				continue;
			}

			// Collect paragraph lines
			const paragraphLines = [];
			while (
				i < lines.length &&
				lines[i].trim() &&
				!lines[i].trim().startsWith('```') &&
				!lines[i].match(/^#{1,6}\s/) &&
				!/^\s*[-*+]\s/.test(lines[i]) &&
				!/^\s*\d+\.\s/.test(lines[i])
			) {
				paragraphLines.push(lines[i]);
				i++;
			}

			if (paragraphLines.length > 0) {
				const paragraphText = paragraphLines.join('\n');
				nodes.push({
					type: 'paragraph',
					content: this._parseInlineFormatting(paragraphText)
				});
			}
		}

		return nodes;
	}

	/**
	 * Enhanced inline formatting parser with better error handling
	 * @param {string} text - Text to parse for inline formatting
	 * @returns {Array} - Array of ADF text nodes with appropriate marks
	 * @private
	 */
	_parseInlineFormatting(text) {
		if (!text) return [{ type: 'text', text: '' }];

		try {
			return this._processInlineFormatting(text);
		} catch (error) {
			// Fallback to plain text if inline formatting fails
			console.warn(
				'Inline formatting parsing failed, falling back to plain text:',
				error.message
			);
			return [{ type: 'text', text }];
		}
	}

	/**
	 * Process inline formatting patterns
	 * @param {string} text - Text to process
	 * @returns {Array} - Array of formatted text nodes
	 * @private
	 */
	_processInlineFormatting(text) {
		const elements = [];
		let remaining = text;

		// Define all patterns with their processors
		const patterns = [
			{ regex: /^\*\*(.*?)\*\*/, type: 'strong', priority: 1 },
			{ regex: /^`([^`\n]+?)`/, type: 'code', priority: 2 }, // Avoid matching triple backticks
			{ regex: /^\[(.*?)\]\((.*?)\)/, type: 'link', priority: 3 },
			{ regex: /^\*(.*?)\*/, type: 'em', priority: 4 }
		];

		while (remaining.length > 0) {
			let matched = false;

			// Try each pattern in priority order
			for (const pattern of patterns) {
				const match = remaining.match(pattern.regex);
				if (match) {
					matched = true;

					if (pattern.type === 'link') {
						elements.push({
							type: 'text',
							marks: [
								{
									type: 'link',
									attrs: {
										href: match[2],
										title: match[1]
									}
								}
							],
							text: match[1]
						});
					} else {
						elements.push({
							type: 'text',
							marks: [{ type: pattern.type }],
							text: match[1]
						});
					}

					remaining = remaining.substring(match[0].length);
					break;
				}
			}

			// If no pattern matched, take the next character
			if (!matched) {
				const nextChar = remaining.charAt(0);

				// Combine with previous plain text element if possible
				if (
					elements.length > 0 &&
					elements[elements.length - 1].type === 'text' &&
					(!elements[elements.length - 1].marks ||
						elements[elements.length - 1].marks.length === 0)
				) {
					elements[elements.length - 1].text += nextChar;
				} else {
					elements.push({ type: 'text', text: nextChar });
				}

				remaining = remaining.substring(1);
			}
		}

		return elements.length > 0 ? elements : [{ type: 'text', text }];
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
		const result = {
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
			attachments: this.attachments,
			issueType: this.issueType
		};

		// Add context if available
		if (this.relatedContext) {
			result.relatedContext = this.relatedContext;
		}

		return result;
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

					// Extract panel content (including the heading for better context)
					const extractedContent = JiraTicket.extractTextFromNodes(item.content);

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
	 * Extract plain text description from Jira description field (full content, not just first paragraph)
	 * @param {Object} description - Jira description object in Atlassian Document Format
	 * @returns {string} - Plain text description
	 */
	static extractPlainTextDescription(description) {
		if (!description || !description.content) {
			return 'No description';
		}

		// Extract ALL content from description, not just first paragraph
		const fullText = JiraTicket.extractTextFromNodes(description.content).trim();
		
		if (fullText) {
			return fullText;
		}

		return 'No description';
	}

	/**
	 * Parse structured description content into sections based on headings
	 * @param {string} fullDescription - Full description text
	 * @returns {Object} - Object with parsed sections
	 */
	static parseStructuredDescription(fullDescription) {
		if (!fullDescription) {
			return {
				description: '',
				acceptanceCriteria: '',
				details: '',
				testStrategy: ''
			};
		}

		const lines = fullDescription.split('\n');
		const sections = {
			description: '',
			acceptanceCriteria: '',
			details: '',
			testStrategy: ''
		};

		let currentSection = 'description';
		let descriptionLines = [];
		let acceptanceCriteriaLines = [];
		let detailsLines = [];
		let testStrategyLines = [];

		for (const line of lines) {
			const trimmedLine = line.trim();
			
			// Check for section headings (case insensitive, more precise matching)
			const lowerLine = trimmedLine.toLowerCase();
			
			// Check for Implementation Details / Technical Details section
			if (this._isImplementationDetailsHeader(lowerLine)) {
				currentSection = 'details';
				detailsLines.push(line); // Include the header in the section
				continue;
			}
			
			// Check for Acceptance Criteria / Definition of Done section
			if (this._isAcceptanceCriteriaHeader(lowerLine)) {
				currentSection = 'acceptanceCriteria';
				acceptanceCriteriaLines.push(line); // Include the header in the section
				continue;
			}
			
			// Check for Test Strategy section (but not "test strategy (tdd)" which should stay in acceptance criteria)
			if (this._isTestStrategyHeader(lowerLine) && !lowerLine.includes('(tdd)')) {
				currentSection = 'testStrategy';
				testStrategyLines.push(line); // Include the header in the section
				continue;
			}

			// Add line to current section
			switch (currentSection) {
				case 'acceptanceCriteria':
					// Don't include lines that start a new major section
					if (this._isTestStrategyHeader(lowerLine) && !lowerLine.includes('(tdd)')) {
						// This line will be handled by test strategy section
						currentSection = 'testStrategy';
						testStrategyLines.push(line);
					} else {
						acceptanceCriteriaLines.push(line);
					}
					break;
				case 'details':
					detailsLines.push(line);
					break;
				case 'testStrategy':
					testStrategyLines.push(line);
					break;
				default:
					descriptionLines.push(line);
			}
		}

		sections.description = descriptionLines.join('\n').trim();
		sections.acceptanceCriteria = acceptanceCriteriaLines.join('\n').trim();
		sections.details = detailsLines.join('\n').trim();
		sections.testStrategy = testStrategyLines.join('\n').trim();

		return sections;
	}

	/**
	 * Check if a line is an Implementation Details header
	 * @param {string} lowerLine - Line text in lowercase
	 * @returns {boolean} - True if it's an implementation details header
	 * @private
	 */
	static _isImplementationDetailsHeader(lowerLine) {
		// Check for various forms of implementation details headers
		const patterns = [
			/^#{1,6}\s*implementation\s*details?\s*$/,
			/^#{1,6}\s*technical\s*details?\s*$/,
			/^#{1,6}\s*details?\s*$/,
			/^implementation\s*details?\s*$/,
			/^technical\s*details?\s*$/,
			/^details?\s*$/
		];
		
		return patterns.some(pattern => pattern.test(lowerLine));
	}

	/**
	 * Check if a line is an Acceptance Criteria header
	 * @param {string} lowerLine - Line text in lowercase
	 * @returns {boolean} - True if it's an acceptance criteria header
	 * @private
	 */
	static _isAcceptanceCriteriaHeader(lowerLine) {
		// Check for various forms of acceptance criteria headers
		const patterns = [
			/^#{1,6}\s*acceptance\s*criteria\s*$/,
			/^#{1,6}\s*definition\s*of\s*done\s*$/,
			/^#{1,6}\s*dod\s*$/,
			/^acceptance\s*criteria\s*$/,
			/^definition\s*of\s*done\s*$/
		];
		
		return patterns.some(pattern => pattern.test(lowerLine));
	}

	/**
	 * Check if a line is a Test Strategy header
	 * @param {string} lowerLine - Line text in lowercase
	 * @returns {boolean} - True if it's a test strategy header
	 * @private
	 */
	static _isTestStrategyHeader(lowerLine) {
		// Check for various forms of test strategy headers
		const patterns = [
			/^#{1,6}\s*test\s*strategy\s*(\(tdd\))?\s*$/,
			/^#{1,6}\s*testing\s*strategy\s*$/,
			/^#{1,6}\s*testing\s*approach\s*$/,
			/^#{1,6}\s*testing\s*$/,
			/^test\s*strategy\s*(\(tdd\))?\s*$/,
			/^testing\s*strategy\s*$/,
			/^testing\s*approach\s*$/
		];
		
		return patterns.some(pattern => pattern.test(lowerLine));
	}

	/**
	 * Extract content that is not in panels from ADF description
	 * @param {Object} description - Jira description object in Atlassian Document Format
	 * @returns {string} - Content that is not in panels
	 * @private
	 */
	static _extractNonPanelContent(description) {
		if (!description || !description.content) {
			return 'No description';
		}

		// Filter out panel content and extract only non-panel nodes
		const nonPanelNodes = description.content.filter(node => {
			return node.type !== 'panel' && node.type !== 'rule';
		});

		// Extract text from non-panel nodes
		const nonPanelText = JiraTicket.extractTextFromNodes(nonPanelNodes).trim();
		
		return nonPanelText || 'No description';
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
				// Silent mode - don't use console.warn in MCP context as it breaks JSON protocol
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

		// Extract full description text if available
		let description = 'No description';
		let acceptanceCriteria = '';
		let details = '';
		let testStrategy = '';
		
		if (jiraIssue.fields?.description) {
			try {
				const fullDescription = JiraTicket.extractPlainTextDescription(
					jiraIssue.fields.description
				) || 'No description';
				
				// Always try to parse structured content from the full description
				// This handles both cases: when panels exist and when they don't
				const sections = JiraTicket.parseStructuredDescription(fullDescription);
				
				// Use parsed sections as the base
				description = sections.description || fullDescription;
				acceptanceCriteria = sections.acceptanceCriteria || '';
				details = sections.details || '';
				testStrategy = sections.testStrategy || '';
				
				// If we have panels, prefer non-panel content for description
				// but keep the parsed structured sections as fallback
				if (Object.keys(panelData).length > 0) {
					const nonPanelDescription = JiraTicket._extractNonPanelContent(jiraIssue.fields.description);
					// Only use non-panel description if it's substantially different and not empty
					if (nonPanelDescription && nonPanelDescription !== 'No description' && 
						nonPanelDescription.length < fullDescription.length * 0.8) {
						description = nonPanelDescription;
					}
					// Panel data will override structured sections if they exist (handled in update call below)
				}
			} catch (error) {
				// Silent mode - don't use console.warn in MCP context as it breaks JSON protocol
			}
		}

		// Create the initial ticket with standard fields
		const ticket = new JiraTicket({
			title: jiraIssue.fields?.summary || '',
			description: description,
			acceptanceCriteria: acceptanceCriteria,
			details: details,
			testStrategy: testStrategy,
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
