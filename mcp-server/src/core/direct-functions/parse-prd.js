/**
 * parse-prd.js
 * Direct function implementation for parsing PRD documents
 */

import path from 'path';
import fs from 'fs';
import { parsePRD } from '../../../../scripts/modules/task-manager.js';
import {
	enableSilentMode,
	disableSilentMode,
	isSilentMode
} from '../../../../scripts/modules/utils.js';
import { createLogWrapper } from '../../tools/utils.js';
import { getDefaultNumTasks } from '../../../../scripts/modules/config-manager.js';
import { createJiraIssue } from '../utils/jira-utils.js';
import { JiraClient } from '../utils/jira-client.js';
import { JiraTicket } from '../utils/jira-ticket.js';
import { generateObjectService } from '../../../../scripts/modules/ai-services-unified.js';

/**
 * Direct function wrapper for parsing PRD documents and generating tasks.
 *
 * @param {Object} args - Command arguments containing projectRoot, input, output, numTasks options.
 * @param {Object} log - Logger object.
 * @param {Object} context - Context object containing session data.
 * @returns {Promise<Object>} - Result object with success status and data/error information.
 */
export async function parsePRDDirect(args, log, context = {}) {
	const { session } = context;
	// Extract projectRoot from args
	const {
		input: inputArg,
		output: outputArg,
		numTasks: numTasksArg,
		force,
		append,
		projectRoot
	} = args;

	// Create the standard logger wrapper
	const logWrapper = createLogWrapper(log);

	// --- Input Validation and Path Resolution ---
	if (!projectRoot) {
		logWrapper.error('parsePRDDirect requires a projectRoot argument.');
		return {
			success: false,
			error: {
				code: 'MISSING_ARGUMENT',
				message: 'projectRoot is required.'
			}
		};
	}
	if (!inputArg) {
		logWrapper.error('parsePRDDirect called without input path');
		return {
			success: false,
			error: { code: 'MISSING_ARGUMENT', message: 'Input path is required' }
		};
	}

	// Resolve input and output paths relative to projectRoot
	const inputPath = path.resolve(projectRoot, inputArg);
	const outputPath = outputArg
		? path.resolve(projectRoot, outputArg)
		: path.resolve(projectRoot, 'tasks', 'tasks.json'); // Default output path

	// Check if input file exists
	if (!fs.existsSync(inputPath)) {
		const errorMsg = `Input PRD file not found at resolved path: ${inputPath}`;
		logWrapper.error(errorMsg);
		return {
			success: false,
			error: { code: 'FILE_NOT_FOUND', message: errorMsg }
		};
	}

	const outputDir = path.dirname(outputPath);
	try {
		if (!fs.existsSync(outputDir)) {
			logWrapper.info(`Creating output directory: ${outputDir}`);
			fs.mkdirSync(outputDir, { recursive: true });
		}
	} catch (dirError) {
		logWrapper.error(
			`Failed to create output directory ${outputDir}: ${dirError.message}`
		);
		// Return an error response immediately if dir creation fails
		return {
			success: false,
			error: {
				code: 'DIRECTORY_CREATION_ERROR',
				message: `Failed to create output directory: ${dirError.message}`
			}
		};
	}

	let numTasks = getDefaultNumTasks(projectRoot);
	if (numTasksArg) {
		numTasks =
			typeof numTasksArg === 'string' ? parseInt(numTasksArg, 10) : numTasksArg;
		if (isNaN(numTasks) || numTasks <= 0) {
			// Ensure positive number
			numTasks = getDefaultNumTasks(projectRoot); // Fallback to default if parsing fails or invalid
			logWrapper.warn(
				`Invalid numTasks value: ${numTasksArg}. Using default: ${numTasks}`
			);
		}
	}

	const useForce = force === true;
	const useAppend = append === true;
	if (useAppend) {
		logWrapper.info('Append mode enabled.');
		if (useForce) {
			logWrapper.warn(
				'Both --force and --append flags were provided. --force takes precedence; append mode will be ignored.'
			);
		}
	}

	logWrapper.info(
		`Parsing PRD via direct function. Input: ${inputPath}, Output: ${outputPath}, NumTasks: ${numTasks}, Force: ${useForce}, Append: ${useAppend}, ProjectRoot: ${projectRoot}`
	);

	const wasSilent = isSilentMode();
	if (!wasSilent) {
		enableSilentMode();
	}

	try {
		// Call the core parsePRD function
		const result = await parsePRD(
			inputPath,
			outputPath,
			numTasks,
			{ session, mcpLog: logWrapper, projectRoot, useForce, useAppend },
			'json'
		);

		// parsePRD returns { success: true, tasks: processedTasks } on success
		if (result && result.success && Array.isArray(result.tasks)) {
			logWrapper.success(
				`Successfully parsed PRD. Generated ${result.tasks.length} tasks.`
			);
			return {
				success: true,
				data: {
					message: `Successfully parsed PRD and generated ${result.tasks.length} tasks.`,
					outputPath: outputPath,
					taskCount: result.tasks.length
				}
			};
		} else {
			// Handle case where core function didn't return expected success structure
			logWrapper.error(
				'Core parsePRD function did not return a successful structure.'
			);
			return {
				success: false,
				error: {
					code: 'CORE_FUNCTION_ERROR',
					message:
						result?.message ||
						'Core function failed to parse PRD or returned unexpected result.'
				}
			};
		}
	} catch (error) {
		logWrapper.error(`Error executing core parsePRD: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'PARSE_PRD_CORE_ERROR',
				message: error.message || 'Unknown error parsing PRD'
			}
		};
	} finally {
		if (!wasSilent && isSilentMode()) {
			disableSilentMode();
		}
	}
}

/**
 * Parse a Product Requirements Document and generate tasks with Jira integration
 * @param {Object} args - Tool arguments
 * @param {string} args.prd - the prd document to parse
 * @param {string} [args.numTasks] - Approximate number of tasks to generate
 * @param {string} [args.jiraIssueType='Task'] - Jira issue type
 * @param {string} [args.jiraParentIssue] - Jira parent issue key
 * @param {Object} log - FastMCP logger
 * @param {Object} context - Execution context
 * @param {Object} context.session - Session data
 * @returns {Promise<Object>} Result object with success flag and data/error
 */
export async function parsePRDWithJiraDirect(args, log, context = {}) {
	const { session } = context;

	try {
		log.info(
			`Parsing PRD document for Jira with args: ${JSON.stringify(args)}`
		);

		// Check if Jira is enabled using the JiraClient
		const jiraClient = new JiraClient();

		if (!jiraClient.isReady()) {
			return {
				success: false,
				error: {
					code: 'JIRA_NOT_ENABLED',
					message: 'Jira integration is not properly configured'
				}
			};
		}

		// Parse number of tasks - handle both string and number values
		let numTasks = 10; // Default
		if (args.numTasks) {
			numTasks =
				typeof args.numTasks === 'string'
					? parseInt(args.numTasks, 10)
					: args.numTasks;
			if (isNaN(numTasks)) {
				numTasks = 10; // Fallback to default if parsing fails
				log.warn(`Invalid numTasks value: ${args.numTasks}. Using default: 10`);
			}
		}

		// Create the logger wrapper for proper logging in the AI functions
		const logWrapper = {
			info: (message, ...args) => log.info(message, ...args),
			warn: (message, ...args) => log.warn(message, ...args),
			error: (message, ...args) => log.error(message, ...args),
			debug: (message, ...args) => log.debug && log.debug(message, ...args),
			success: (message, ...args) => log.info(message, ...args) // Map success to info
		};

		// Enable silent mode to prevent console logs from interfering with JSON response
		enableSilentMode();

		// Read the PRD content
		log.info(`Reading PRD content from: ${args.prd}`);
		const prdContent = args.prd;

		// Build system prompt for PRD parsing
		const systemPrompt = `You are an AI assistant specialized in analyzing Product Requirements Documents (PRDs) and generating a structured, logically ordered, dependency-aware and sequenced list of development tasks in JSON format.
Analyze the provided PRD content and generate approximately ${numTasks} top-level development tasks. If the complexity or the level of detail of the PRD is high, generate more tasks relative to the complexity of the PRD
Each task should represent a logical unit of work needed to implement the requirements and focus on the most direct and effective way to implement the requirements without unnecessary complexity or overengineering. Include pseudo-code, implementation details, and test strategy for each task. Find the most up to date information to implement each task.
Assign sequential IDs starting from ${nextId}. Infer title, description, details, and test strategy for each task based *only* on the PRD content.
Set status to 'pending', dependencies to an empty array [], and priority to 'medium' initially for all tasks.
Respond ONLY with a valid JSON object containing a single key "tasks", where the value is an array of task objects adhering to the provided Zod schema. Do not include any explanation or markdown formatting.

Each task should follow this JSON structure:
{
	"id": 1,
	"title": "Example Task Title",
	"description": "Detailed description of the task (if needed you can use markdown formatting, e.g. headings, lists, etc.)",
	"acceptanceCriteria": "Detailed acceptance criteria for the task following typical Gherkin syntax",
	"status": "pending",
	"dependencies": [0],
	"priority": "high",
	"details": "Detailed implementation guidance",
	"testStrategy": "A Test Driven Development (TDD) approach for validating this task. Always specify TDD tests for each task if possible."
},

Guidelines:
1. Unless complexity warrants otherwise, create exactly ${numTasks} tasks, numbered sequentially starting from ${nextId}
2. Each task should be atomic and focused on a single responsibility following the most up to date best practices and standards
3. Order tasks logically - consider dependencies and implementation sequence
4. Early tasks should focus on setup, core functionality first, then advanced features
5. Include clear validation/testing approach for each task
6. Set appropriate dependency IDs (a task can only depend on tasks with lower IDs, potentially including existing tasks with IDs less than ${nextId} if applicable)
7. Assign priority (high/medium/low) based on criticality and dependency order
8. Include detailed implementation guidance in the "details" field
9. If the PRD contains specific requirements for libraries, database schemas, frameworks, tech stacks, or any other implementation details, STRICTLY ADHERE to these requirements in your task breakdown and do not discard them under any circumstance
10. Focus on filling in any gaps left by the PRD or areas that aren't fully specified, while preserving all explicit requirements
11. Always aim to provide the most direct path to implementation, avoiding over-engineering or roundabout approaches`;

		// Build user prompt with PRD content
		const userPrompt = `Here's the Product Requirements Document (PRD) to break down into approximately ${numTasks} tasks, starting IDs from ${nextId}:\n\n${prdContent}\n\n

		Return your response in this format:
{
    "tasks": [
        {
            "id": 1,
            "title": "Setup Project Repository",
            "description": "...",
            ...
        },
        ...
    ],
    "metadata": {
        "projectName": "PRD Implementation",
        "totalTasks": ${numTasks},
        "sourceFile": "${prdPath}",
        "generatedAt": "YYYY-MM-DD"
    }
}`;

		// Call generateObjectService with the CORRECT schema
		const generatedData = await generateObjectService({
			role: 'main',
			session: session,
			projectRoot: projectRoot,
			schema: prdResponseSchema,
			objectName: 'tasks_data',
			systemPrompt: systemPrompt,
			prompt: userPrompt,
			reportProgress
		});

		// Validate and Process Tasks
		if (!generatedData || !Array.isArray(generatedData.tasks)) {
			// This error *shouldn't* happen if generateObjectService enforced prdResponseSchema
			// But keep it as a safeguard
			log.error(
				`Internal Error: generateObjectService returned unexpected data structure: ${JSON.stringify(generatedData)}`
			);
			throw new Error(
				'AI service returned unexpected data structure after validation.'
			);
		}

		// Create Jira issues for each task
		log.info(`Creating ${generatedData.tasks.length} Jira issues...`);
		const issueType = args.jiraIssueType || 'Task';
		const createdIssues = [];
		const issueKeyMap = new Map(); // Map task ID to Jira issue key

		for (const task of generatedData.tasks) {
			log.info(`Creating Jira issue for task ${task.id}: ${task.title}`);

			// Use the JiraTicket class to manage the ticket data and ADF conversion
			const jiraTicket = new JiraTicket({
				title: task.title,
				description: task.description,
				details: task.details,
				acceptanceCriteria: task.acceptanceCriteria,
				testStrategy: task.testStrategy,
				priority: task.priority,
				issueType: issueType,
				parentKey: args.jiraParentIssue
			});

			try {
				const result = await createJiraIssue(jiraTicket, log);

				if (result.success) {
					createdIssues.push({
						taskId: task.id,
						jiraKey: result.data.key,
						title: task.title
					});

					// Store mapping for dependency linking
					issueKeyMap.set(task.id, result.data.key);

					log.info(`Created Jira issue ${result.data.key} for task ${task.id}`);
				} else {
					log.error(
						`Failed to create Jira issue for task ${task.id}: ${result.error.message}`
					);
				}
			} catch (error) {
				log.error(
					`Error creating Jira issue for task ${task.id}: ${error.message}`
				);
				return {
					success: false,
					error: {
						code: 'JIRA_ISSUE_CREATION_ERROR',
						message: `Failed to create Jira issue for task ${task.id}: ${error.message}`
					},
					fromCache: false
				};
			}
		}

		// Process dependencies using the Jira Issue Link REST API
		log.info('Processing task dependencies...');
		const dependencyLinks = [];

		for (const task of generatedData.tasks) {
			if (task.dependencies && task.dependencies.length > 0) {
				const issueKey = issueKeyMap.get(task.id);

				if (issueKey) {
					for (const dependencyId of task.dependencies) {
						// Skip dependency on "0" which is often used as a placeholder
						if (dependencyId === 0) continue;

						const dependencyKey = issueKeyMap.get(dependencyId);

						if (dependencyKey) {
							log.info(
								`Linking issue ${issueKey} to depend on ${dependencyKey}`
							);

							try {
								// Create issue link using Jira REST API
								// "Depends on" link type (requires specific type ID for the Jira instance)
								const linkPayload = {
									type: {
										name: 'Blocks' // Common link type - this issue blocks the dependent issue
									},
									inwardIssue: {
										key: dependencyKey
									},
									outwardIssue: {
										key: issueKey
									}
								};

								const client = jiraClient.getClient();
								const response = await client.post(
									'/rest/api/3/issueLink',
									linkPayload
								);

								dependencyLinks.push({
									from: issueKey,
									to: dependencyKey
								});

								log.info(
									`Created dependency link from ${issueKey} to ${dependencyKey}`
								);
							} catch (error) {
								log.error(
									`Error creating dependency link from ${issueKey} to ${dependencyKey}: ${error.message}`
								);
								return {
									success: false,
									error: {
										code: 'JIRA_DEPENDENCY_LINK_ERROR',
										message: `Failed to create Jira dependency link from ${issueKey} to ${dependencyKey}: ${error.message}`
									},
									fromCache: false
								};
							}
						} else {
							log.warn(
								`Dependency task ID ${dependencyId} not found in created issues`
							);
						}
					}
				}
			}
		}

		// Return success with data
		return {
			success: true,
			data: {
				message: `Successfully created ${createdIssues.length} Jira issues from PRD`,
				taskCount: generatedData.tasks.length,
				issuesCreated: createdIssues.length,
				jiraIssueType: issueType,
				parentIssue: args.jiraParentIssue,
				createdIssues,
				dependencyLinks
			},
			fromCache: false
		};
	} catch (error) {
		log.error(`Error in parsePRDWithJiraDirect: ${error.message}`);

		return {
			success: false,
			error: {
				code: 'PARSE_PRD_JIRA_ERROR',
				message: error.message || 'Unknown error parsing PRD for Jira',
				details: error.stack
			},
			fromCache: false
		};
	}
}
