/**
 * tools/parsePRD.js
 * Tool to parse PRD document and generate tasks
 */

import { z } from 'zod';
import path from 'path';
import {
	handleApiResult,
	createErrorResponse,
	withNormalizedProjectRoot
} from './utils.js';
import {
	parsePRDDirect,
	parsePRDWithJiraDirect
} from '../core/task-master-core.js';
import { JiraClient } from '../core/utils/jira-client.js';

/**
 * Register the parse_prd tool
 * @param {Object} server - FastMCP server instance
 */
export function registerParsePRDTool(server) {
	if (!JiraClient.isJiraEnabled()) {
		server.addTool({
			name: 'parse_prd',
			description:
				"Parse a Product Requirements Document (PRD) text file to automatically generate initial tasks. Reinitializing the project is not necessary to run this tool. It is recommended to run parse-prd after initializing the project and creating/importing a prd.txt file in the project root's scripts/ directory.",
			parameters: z.object({
				input: z
					.string()
					.optional()
					.default('scripts/prd.txt')
					.describe('Absolute path to the PRD document file (.txt, .md, etc.)'),
				numTasks: z
					.string()
					.optional()
					.describe(
						'Approximate number of top-level tasks to generate (default: 10). As the agent, if you have enough information, ensure to enter a number of tasks that would logically scale with project complexity. Avoid entering numbers above 50 due to context window limitations.'
					),
				output: z
					.string()
					.optional()
					.describe(
						'Output path for tasks.json file (default: tasks/tasks.json)'
					),
				force: z
					.boolean()
					.optional()
					.default(false)
					.describe('Overwrite existing output file without prompting.'),
				append: z
					.boolean()
					.optional()
					.default(false)
					.describe('Append generated tasks to existing file.'),
				projectRoot: z
					.string()
					.describe('The directory of the project. Must be an absolute path.')
			}),
			execute: withNormalizedProjectRoot(async (args, { log, session }) => {
				const toolName = 'parse_prd';
				try {
					log.info(
						`Executing ${toolName} tool with args: ${JSON.stringify(args)}`
					);

					// Call Direct Function - Pass relevant args including projectRoot
					const result = await parsePRDDirect(
						{
							input: args.input,
							output: args.output,
							numTasks: args.numTasks,
							force: args.force,
							append: args.append,
							projectRoot: args.projectRoot
						},
						log,
						{ session }
					);

					log.info(
						`${toolName}: Direct function result: success=${result.success}`
					);
					return handleApiResult(result, log, 'Error parsing PRD');
				} catch (error) {
					log.error(
						`Critical error in ${toolName} tool execute: ${error.message}`
					);
					return createErrorResponse(
						`Internal tool error (${toolName}): ${error.message}`
					);
				}
			})
		});
	} else {
		server.addTool({
			name: 'parse_prd',
			description:
				'Parse a Product Requirements Document (PRD) text file to automatically generate initial tasks that are saved as Jira issues. This version of the tool integrates with Jira using configured environment variables. Reinitializing the project is not necessary to run this tool.',
			parameters: z.object({
				prd: z.string().optional().describe('The PRD text to parse'),
				numTasks: z
					.string()
					.optional()
					.describe(
						'Approximate number of top-level tasks to generate (default: 10). As the agent, if you have enough information, ensure to enter a number of tasks that would logically scale with project complexity. Avoid entering numbers above 50 due to context window limitations.'
					),
				jiraIssueType: z
					.string()
					.optional()
					.default('Task')
					.describe(
						'Jira issue type (default: "Task", "Epic", "Story", "Bug", "Subtask")'
					),
				jiraParentIssue: z
					.string()
					.optional()
					.describe('Jira issue key of the parent issue/epic to link tasks to')
			}),
			execute: async (args, { log, session }) => {
				try {
					log.info(
						`Parsing PRD with Jira integration. Args: ${JSON.stringify(args)}`
					);

					// Check if PRD path was found
					if (!args.prd) {
						return createErrorResponse(
							'No PRD document found or provided. Please ensure a PRD file exists (e.g., PRD.md) or provide a valid input file path.'
						);
					}

					// Call the direct function with Jira params
					const result = await parsePRDWithJiraDirect(
						{
							prd: args.prd,
							numTasks: args.numTasks,
							// Jira-specific parameters
							jiraIssueType: args.jiraIssueType,
							jiraParentIssue: args.jiraParentIssue
						},
						log,
						{ session }
					);

					if (result.success) {
						log.info(`Successfully parsed PRD: ${result.data.message}`);
					} else {
						log.error(
							`Failed to parse PRD: ${result.error?.message || 'Unknown error'}`
						);
					}

					return handleApiResult(result, log, 'Error parsing PRD');
				} catch (error) {
					log.error(
						`Error in parse-prd tool with Jira integration: ${error.message}`
					);
					return createErrorResponse(error.message);
				}
			}
		});
	}
}
