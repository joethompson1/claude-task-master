/**
 * commands.js
 * Command-line interface for the Task Master CLI
 */

import { program } from 'commander';
import path from 'path';
import chalk from 'chalk';
import boxen from 'boxen';
import fs from 'fs';
import https from 'https';
import inquirer from 'inquirer';
import ora from 'ora'; // Import ora
import Table from 'cli-table3';

import { CONFIG, log, readJSON } from './utils.js';
import {
	parsePRD,
	updateTasks,
	generateTaskFiles,
	setTaskStatus,
	listTasks,
	expandTask,
	expandAllTasks,
	clearSubtasks,
	addTask,
	addSubtask,
	removeSubtask,
	analyzeTaskComplexity,
	updateTaskById,
	updateSubtaskById,
	removeTask,
	findTaskById,
	taskExists
} from './task-manager.js';
import {
	setJiraTaskStatus,
	updateJiraIssues
} from '../../mcp-server/src/core/utils/jira-utils.js';

import {
	addDependency,
	removeDependency,
	validateDependenciesCommand,
	fixDependenciesCommand
} from './dependency-manager.js';

import {
	isApiKeySet,
	getDebugFlag,
	getConfig,
	writeConfig,
	ConfigurationError,
	isConfigFilePresent,
	getAvailableModels
} from './config-manager.js';

import {
	displayBanner,
	displayHelp,
	displayNextTask,
	displayTaskById,
	displayComplexityReport,
	getStatusWithColor,
	confirmTaskOverwrite,
	startLoadingIndicator,
	stopLoadingIndicator,
	displayModelConfiguration,
	displayAvailableModels,
	displayApiKeyStatus
} from './ui.js';

import { initializeProject } from '../init.js';
import { JiraClient } from '../../mcp-server/src/core/utils/jira-client.js';

import {
	getModelConfiguration,
	getAvailableModelsList,
	setModel,
	getApiKeyStatusReport
} from './task-manager/models.js';
import { findProjectRoot } from './utils.js';

/**
 * Runs the interactive setup process for model configuration.
 * @param {string|null} projectRoot - The resolved project root directory.
 */
async function runInteractiveSetup(projectRoot) {
	if (!projectRoot) {
		console.error(
			chalk.red(
				'Error: Could not determine project root for interactive setup.'
			)
		);
		process.exit(1);
	}

	const currentConfigResult = await getModelConfiguration({ projectRoot });
	const currentModels = currentConfigResult.success
		? currentConfigResult.data.activeModels
		: { main: null, research: null, fallback: null };
	// Handle potential config load failure gracefully for the setup flow
	if (
		!currentConfigResult.success &&
		currentConfigResult.error?.code !== 'CONFIG_MISSING'
	) {
		console.warn(
			chalk.yellow(
				`Warning: Could not load current model configuration: ${currentConfigResult.error?.message || 'Unknown error'}. Proceeding with defaults.`
			)
		);
	}

	// Helper function to fetch OpenRouter models (duplicated for CLI context)
	function fetchOpenRouterModelsCLI() {
		return new Promise((resolve) => {
			const options = {
				hostname: 'openrouter.ai',
				path: '/api/v1/models',
				method: 'GET',
				headers: {
					Accept: 'application/json'
				}
			};

			const req = https.request(options, (res) => {
				let data = '';
				res.on('data', (chunk) => {
					data += chunk;
				});
				res.on('end', () => {
					if (res.statusCode === 200) {
						try {
							const parsedData = JSON.parse(data);
							resolve(parsedData.data || []); // Return the array of models
						} catch (e) {
							console.error('Error parsing OpenRouter response:', e);
							resolve(null); // Indicate failure
						}
					} else {
						console.error(
							`OpenRouter API request failed with status code: ${res.statusCode}`
						);
						resolve(null); // Indicate failure
					}
				});
			});

			req.on('error', (e) => {
				console.error('Error fetching OpenRouter models:', e);
				resolve(null); // Indicate failure
			});
			req.end();
		});
	}

	// Helper to get choices and default index for a role
	const getPromptData = (role, allowNone = false) => {
		const currentModel = currentModels[role]; // Use the fetched data
		const allModelsRaw = getAvailableModels(); // Get all available models

		// Manually group models by provider
		const modelsByProvider = allModelsRaw.reduce((acc, model) => {
			if (!acc[model.provider]) {
				acc[model.provider] = [];
			}
			acc[model.provider].push(model);
			return acc;
		}, {});

		const cancelOption = { name: '⏹ Cancel Model Setup', value: '__CANCEL__' }; // Symbol updated
		const noChangeOption = currentModel?.modelId
			? {
					name: `✔ No change to current ${role} model (${currentModel.modelId})`, // Symbol updated
					value: '__NO_CHANGE__'
				}
			: null;

		const customOpenRouterOption = {
			name: '* Custom OpenRouter model', // Symbol updated
			value: '__CUSTOM_OPENROUTER__'
		};

		let choices = [];
		let defaultIndex = 0; // Default to 'Cancel'

		// Filter and format models allowed for this role using the manually grouped data
		const roleChoices = Object.entries(modelsByProvider)
			.map(([provider, models]) => {
				const providerModels = models
					.filter((m) => m.allowed_roles.includes(role))
					.map((m) => ({
						name: `${provider} / ${m.id} ${
							m.cost_per_1m_tokens
								? chalk.gray(
										`($${m.cost_per_1m_tokens.input.toFixed(2)} input | $${m.cost_per_1m_tokens.output.toFixed(2)} output)`
									)
								: ''
						}`,
						value: { id: m.id, provider },
						short: `${provider}/${m.id}`
					}));
				if (providerModels.length > 0) {
					return [...providerModels];
				}
				return null;
			})
			.filter(Boolean)
			.flat();

		// Find the index of the currently selected model for setting the default
		let currentChoiceIndex = -1;
		if (currentModel?.modelId && currentModel?.provider) {
			currentChoiceIndex = roleChoices.findIndex(
				(choice) =>
					typeof choice.value === 'object' &&
					choice.value.id === currentModel.modelId &&
					choice.value.provider === currentModel.provider
			);
		}

		// Construct final choices list based on whether 'None' is allowed
		const commonPrefix = [];
		if (noChangeOption) {
			commonPrefix.push(noChangeOption);
		}
		commonPrefix.push(cancelOption);
		commonPrefix.push(customOpenRouterOption);

		let prefixLength = commonPrefix.length; // Initial prefix length

		if (allowNone) {
			choices = [
				...commonPrefix,
				new inquirer.Separator(),
				{ name: '⚪ None (disable)', value: null }, // Symbol updated
				new inquirer.Separator(),
				...roleChoices
			];
			// Adjust default index: Prefix + Sep1 + None + Sep2 (+3)
			const noneOptionIndex = prefixLength + 1;
			defaultIndex =
				currentChoiceIndex !== -1
					? currentChoiceIndex + prefixLength + 3 // Offset by prefix and separators
					: noneOptionIndex; // Default to 'None' if no current model matched
		} else {
			choices = [
				...commonPrefix,
				new inquirer.Separator(),
				...roleChoices,
				new inquirer.Separator()
			];
			// Adjust default index: Prefix + Sep (+1)
			defaultIndex =
				currentChoiceIndex !== -1
					? currentChoiceIndex + prefixLength + 1 // Offset by prefix and separator
					: noChangeOption
						? 1
						: 0; // Default to 'No Change' if present, else 'Cancel'
		}

		// Ensure defaultIndex is valid within the final choices array length
		if (defaultIndex < 0 || defaultIndex >= choices.length) {
			// If default calculation failed or pointed outside bounds, reset intelligently
			defaultIndex = 0; // Default to 'Cancel'
			console.warn(
				`Warning: Could not determine default model for role '${role}'. Defaulting to 'Cancel'.`
			); // Add warning
		}

		return { choices, default: defaultIndex };
	};

	// --- Generate choices using the helper ---
	const mainPromptData = getPromptData('main');
	const researchPromptData = getPromptData('research');
	const fallbackPromptData = getPromptData('fallback', true); // Allow 'None' for fallback

	const answers = await inquirer.prompt([
		{
			type: 'list',
			name: 'mainModel',
			message: 'Select the main model for generation/updates:',
			choices: mainPromptData.choices,
			default: mainPromptData.default
		},
		{
			type: 'list',
			name: 'researchModel',
			message: 'Select the research model:',
			choices: researchPromptData.choices,
			default: researchPromptData.default,
			when: (ans) => ans.mainModel !== '__CANCEL__'
		},
		{
			type: 'list',
			name: 'fallbackModel',
			message: 'Select the fallback model (optional):',
			choices: fallbackPromptData.choices,
			default: fallbackPromptData.default,
			when: (ans) =>
				ans.mainModel !== '__CANCEL__' && ans.researchModel !== '__CANCEL__'
		}
	]);

	let setupSuccess = true;
	let setupConfigModified = false;
	const coreOptionsSetup = { projectRoot }; // Pass root for setup actions

	// Helper to handle setting a model (including custom)
	async function handleSetModel(role, selectedValue, currentModelId) {
		if (selectedValue === '__CANCEL__') {
			console.log(
				chalk.yellow(`\nSetup canceled during ${role} model selection.`)
			);
			setupSuccess = false; // Also mark success as false on cancel
			return false; // Indicate cancellation
		}

		// Handle the new 'No Change' option
		if (selectedValue === '__NO_CHANGE__') {
			console.log(chalk.gray(`No change selected for ${role} model.`));
			return true; // Indicate success, continue setup
		}

		let modelIdToSet = null;
		let providerHint = null;
		let isCustomSelection = false;

		if (selectedValue === '__CUSTOM_OPENROUTER__') {
			isCustomSelection = true;
			const { customId } = await inquirer.prompt([
				{
					type: 'input',
					name: 'customId',
					message: `Enter the custom OpenRouter Model ID for the ${role} role:`
				}
			]);
			if (!customId) {
				console.log(chalk.yellow('No custom ID entered. Skipping role.'));
				return true; // Continue setup, but don't set this role
			}
			modelIdToSet = customId;
			providerHint = 'openrouter';
			// Validate against live OpenRouter list
			const openRouterModels = await fetchOpenRouterModelsCLI();
			if (
				!openRouterModels ||
				!openRouterModels.some((m) => m.id === modelIdToSet)
			) {
				console.error(
					chalk.red(
						`Error: Model ID "${modelIdToSet}" not found in the live OpenRouter model list. Please check the ID.`
					)
				);
				setupSuccess = false;
				return true; // Continue setup, but mark as failed
			}
		} else if (
			selectedValue &&
			typeof selectedValue === 'object' &&
			selectedValue.id
		) {
			// Standard model selected from list
			modelIdToSet = selectedValue.id;
			providerHint = selectedValue.provider; // Provider is known
		} else if (selectedValue === null && role === 'fallback') {
			// Handle disabling fallback
			modelIdToSet = null;
			providerHint = null;
		} else if (selectedValue) {
			console.error(
				chalk.red(
					`Internal Error: Unexpected selection value for ${role}: ${JSON.stringify(selectedValue)}`
				)
			);
			setupSuccess = false;
			return true;
		}

		// Only proceed if there's a change to be made
		if (modelIdToSet !== currentModelId) {
			if (modelIdToSet) {
				// Set a specific model (standard or custom)
				const result = await setModel(role, modelIdToSet, {
					...coreOptionsSetup,
					providerHint // Pass the hint
				});
				if (result.success) {
					console.log(
						chalk.blue(
							`Set ${role} model: ${result.data.provider} / ${result.data.modelId}`
						)
					);
					if (result.data.warning) {
						// Display warning if returned by setModel
						console.log(chalk.yellow(result.data.warning));
					}
					setupConfigModified = true;
				} else {
					console.error(
						chalk.red(
							`Error setting ${role} model: ${result.error?.message || 'Unknown'}`
						)
					);
					setupSuccess = false;
				}
			} else if (role === 'fallback') {
				// Disable fallback model
				const currentCfg = getConfig(projectRoot);
				if (currentCfg?.models?.fallback?.modelId) {
					// Check if it was actually set before clearing
					currentCfg.models.fallback = {
						...currentCfg.models.fallback,
						provider: undefined,
						modelId: undefined
					};
					if (writeConfig(currentCfg, projectRoot)) {
						console.log(chalk.blue('Fallback model disabled.'));
						setupConfigModified = true;
					} else {
						console.error(
							chalk.red('Failed to disable fallback model in config file.')
						);
						setupSuccess = false;
					}
				} else {
					console.log(chalk.blue('Fallback model was already disabled.'));
				}
			}
		}
		return true; // Indicate setup should continue
	}

	// Process answers using the handler
	if (
		!(await handleSetModel(
			'main',
			answers.mainModel,
			currentModels.main?.modelId // <--- Now 'currentModels' is defined
		))
	) {
		return false; // Explicitly return false if cancelled
	}
	if (
		!(await handleSetModel(
			'research',
			answers.researchModel,
			currentModels.research?.modelId // <--- Now 'currentModels' is defined
		))
	) {
		return false; // Explicitly return false if cancelled
	}
	if (
		!(await handleSetModel(
			'fallback',
			answers.fallbackModel,
			currentModels.fallback?.modelId // <--- Now 'currentModels' is defined
		))
	) {
		return false; // Explicitly return false if cancelled
	}

	if (setupSuccess && setupConfigModified) {
		console.log(chalk.green.bold('\nModel setup complete!'));
	} else if (setupSuccess && !setupConfigModified) {
		console.log(chalk.yellow('\nNo changes made to model configuration.'));
	} else if (!setupSuccess) {
		console.error(
			chalk.red(
				'\nErrors occurred during model selection. Please review and try again.'
			)
		);
	}
	return true; // Indicate setup flow completed (not cancelled)
	// Let the main command flow continue to display results
}

/**
 * Configure and register CLI commands
 * @param {Object} program - Commander program instance
 */
function registerCommands(programInstance) {
	// Add global error handler for unknown options
	programInstance.on('option:unknown', function (unknownOption) {
		const commandName = this._name || 'unknown';
		console.error(chalk.red(`Error: Unknown option '${unknownOption}'`));
		console.error(
			chalk.yellow(
				`Run 'task-master ${commandName} --help' to see available options`
			)
		);
		process.exit(1);
	});

	// Default help
	programInstance.on('--help', function () {
		displayHelp();
	});

	// parse-prd command
	programInstance
		.command('parse-prd')
		.description(() => JiraClient.isJiraEnabled() 
			? 'Parse a PRD file and generate Jira issues' 
			: 'Parse a PRD file and generate tasks')
		.argument('[file]', 'Path to the PRD file')
		.option(
			'-i, --input <file>',
			'Path to the PRD file (alternative to positional argument)'
		)
		.option('-o, --output <file>', 'Output file path', 'tasks/tasks.json')
		.option('-n, --num-tasks <number>', 'Number of tasks to generate', '10')
		.option('-f, --force', 'Skip confirmation when overwriting existing tasks')
		.option(
			'--append',
			'Append new tasks to existing tasks.json instead of overwriting'
		)
		.option(
			'--jira-issue-type <type>',
			() => JiraClient.isJiraEnabled() 
				? 'Jira issue type (default: "Task", "Epic", "Story", "Bug", "Subtask")' 
				: 'Jira issue type (only used when Jira is enabled)',
			'Task'
		)
		.option(
			'--jira-parent-issue <key>',
			() => JiraClient.isJiraEnabled() 
				? 'Jira issue key of the parent issue/epic to link tasks to' 
				: 'Jira parent issue key (only used when Jira is enabled)'
		)
		.action(async (file, options) => {
			const isJiraEnabled = JiraClient.isJiraEnabled();
			const numTasks = parseInt(options.numTasks, 10);
			
			if (isJiraEnabled) {
				// Jira mode
				// Use input option if file argument not provided
				const inputFile = file || options.input;
				const defaultPrdPath = 'scripts/prd.txt';
				const jiraIssueType = options.jiraIssueType || 'Task';
				const jiraParentIssue = options.jiraParentIssue;
				
				// If no input file specified, check for default PRD location
				if (!inputFile) {
					console.log(
						chalk.yellow(
							'No PRD file specified and default PRD file not found at scripts/prd.txt.'
						)
					);
					console.log(
						boxen(
							chalk.white.bold('Parse PRD Help (Jira Mode)') +
								'\n\n' +
								chalk.cyan('Usage:') +
								'\n' +
								`  task-master parse-prd <prd-file.txt> [options]\n\n` +
								chalk.cyan('Options:') +
								'\n' +
								'  -i, --input <file>           Path to the PRD file (alternative to positional argument)\n' +
								'  -n, --num-tasks <number>     Number of tasks to generate (default: 10)\n' +
								'  --jira-issue-type <type>     Jira issue type (default: "Task")\n' +
								'  --jira-parent-issue <key>    Parent Jira issue key to link tasks to\n\n' +
								chalk.cyan('Example:') +
								'\n' +
								'  task-master parse-prd requirements.txt --num-tasks 15\n' +
								'  task-master parse-prd --input=requirements.txt --jira-issue-type=Story\n' +
								'  task-master parse-prd --jira-parent-issue=PROJ-123\n\n' +
								chalk.yellow('Note: This command will:') +
								'\n' +
								'  1. Look for a PRD file at scripts/prd.txt by default\n' +
								'  2. Use the file specified by --input or positional argument if provided\n' +
								'  3. Generate Jira issues from the PRD content\n' +
								'  4. Link the issues to a parent issue if specified',
							{ padding: 1, borderColor: 'blue', borderStyle: 'round' }
						)
					);
					return;
				}
				
				// Process the specified PRD file
				if (!fs.existsSync(inputFile)) {
					console.error(chalk.red(`Error: PRD file not found at path: ${inputFile}`));
					process.exit(1);
				}
				
				// Read the PRD content
				const prdContent = fs.readFileSync(inputFile, 'utf8');
				
				console.log(chalk.blue(`Parsing PRD file: ${inputFile}`));
				console.log(chalk.blue(`Generating ${numTasks} Jira issues...`));
				console.log(chalk.blue(`Issue type: ${jiraIssueType}`));
				if (jiraParentIssue) {
					console.log(chalk.blue(`Parent issue: ${jiraParentIssue}`));
				}
				
				// Import the parsePRDWithJiraDirect function dynamically
				const { parsePRDWithJiraDirect } = await import('../../mcp-server/src/core/direct-functions/parse-prd.js');
				
				try {
					const result = await parsePRDWithJiraDirect(
						{
							prd: prdContent,
							numTasks: options.numTasks,
							jiraIssueType: jiraIssueType,
							jiraParentIssue: jiraParentIssue
						},
						{ 
							info: (msg) => console.log(chalk.blue(msg)), 
							warn: (msg) => console.log(chalk.yellow(msg)), 
							error: (msg) => console.error(chalk.red(msg))
						},
						{ session: process.env }
					);
					
					if (result.success) {
						console.log(chalk.green(result.data.message));
						console.log(chalk.green(`Created ${result.data.issuesCreated} Jira issues.`));
					} else {
						console.error(chalk.red(`Error: ${result.error.message}`));
						process.exit(1);
					}
				} catch (error) {
					console.error(chalk.red(`Error parsing PRD for Jira: ${error.message}`));
					process.exit(1);
				}
			} else {
				// Local mode (original implementation)
				// Use input option if file argument not provided
				const inputFile = file || options.input;
				const defaultPrdPath = 'scripts/prd.txt';
				const outputPath = options.output;
				const force = options.force || false;
				const append = options.append || false;

				// Helper function to check if tasks.json exists and confirm overwrite
				async function confirmOverwriteIfNeeded() {
					if (fs.existsSync(outputPath) && !force && !append) {
						const shouldContinue = await confirmTaskOverwrite(outputPath);
						if (!shouldContinue) {
							console.log(chalk.yellow('Operation cancelled by user.'));
							return false;
						}
					}
					return true;
				}

				let spinner;

				try {
					if (!inputFile) {
						if (fs.existsSync(defaultPrdPath)) {
							console.log(
								chalk.blue(`Using default PRD file path: ${defaultPrdPath}`)
							);
							if (!(await confirmOverwriteIfNeeded())) return;

							console.log(chalk.blue(`Generating ${numTasks} tasks...`));
							spinner = ora('Parsing PRD and generating tasks...').start();
							await parsePRD(defaultPrdPath, outputPath, numTasks, {
								useAppend,
								useForce
							});
							spinner.succeed('Tasks generated successfully!');
							return;
						}

						console.log(
							chalk.yellow(
								'No PRD file specified and default PRD file not found at scripts/prd.txt.'
							)
						);
						console.log(
							boxen(
								chalk.white.bold('Parse PRD Help') +
									'\n\n' +
									chalk.cyan('Usage:') +
									'\n' +
									`  task-master parse-prd <prd-file.txt> [options]\n\n` +
									chalk.cyan('Options:') +
									'\n' +
									'  -i, --input <file>       Path to the PRD file (alternative to positional argument)\n' +
									'  -o, --output <file>      Output file path (default: "tasks/tasks.json")\n' +
									'  -n, --num-tasks <number> Number of tasks to generate (default: 10)\n' +
									'  -f, --force              Skip confirmation when overwriting existing tasks\n' +
									'  --append                 Append new tasks to existing tasks.json instead of overwriting\n\n' +
									chalk.cyan('Example:') +
									'\n' +
									'  task-master parse-prd requirements.txt --num-tasks 15\n' +
									'  task-master parse-prd --input=requirements.txt\n' +
									'  task-master parse-prd --force\n' +
									'  task-master parse-prd requirements_v2.txt --append\n\n' +
									chalk.yellow('Note: This command will:') +
									'\n' +
									'  1. Look for a PRD file at scripts/prd.txt by default\n' +
									'  2. Use the file specified by --input or positional argument if provided\n' +
									'  3. Generate tasks from the PRD and either:\n' +
									'     - Overwrite any existing tasks.json file (default)\n' +
									'     - Append to existing tasks.json if --append is used',
								{ padding: 1, borderColor: 'blue', borderStyle: 'round' }
							)
						);
						return;
					}

					if (!fs.existsSync(inputFile)) {
						console.error(
							chalk.red(`Error: Input PRD file not found: ${inputFile}`)
						);
						process.exit(1);
					}

					if (!(await confirmOverwriteIfNeeded())) return;

					console.log(chalk.blue(`Parsing PRD file: ${inputFile}`));
					console.log(chalk.blue(`Generating ${numTasks} tasks...`));
					if (append) {
						console.log(chalk.blue('Appending to existing tasks...'));
					}

					spinner = ora('Parsing PRD and generating tasks...').start();
					await parsePRD(inputFile, outputPath, numTasks, {
						append: useAppend,
						force: useForce
					});
					spinner.succeed('Tasks generated successfully!');
				} catch (error) {
					if (spinner) {
						spinner.fail(`Error parsing PRD: ${error.message}`);
					} else {
						console.error(chalk.red(`Error parsing PRD: ${error.message}`));
					}
					process.exit(1);
				}
			}
		});

	// update command
	programInstance
		.command('update')
		.description(
			'Update multiple tasks with ID >= "from" based on new information or implementation changes'
		)
		.option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
		.option(
			'--from <id>', 
			() => JiraClient.isJiraEnabled() 
				? 'Jira issue key(s) to update (e.g., "PROJ-123" or "PROJ-123,PROJ-124")' 
				: 'Task ID to start updating from (tasks with ID >= this value will be updated)',
			'1'
		)
		.option(
			'-p, --prompt <text>',
			'Prompt explaining the changes or new context (required)'
		)
		.option(
			'-r, --research',
			'Use Perplexity AI for research-backed task updates'
		)
		.option(
			'--parent-key <key>',
			() => JiraClient.isJiraEnabled()
				? 'Parent Jira issue key to filter tasks by'
				: 'Parent Jira issue key (only used when Jira is enabled)'
		)
		.action(async (options) => {
			const prompt = options.prompt;
			const useResearch = options.research || false;
			const isJiraEnabled = JiraClient.isJiraEnabled();

			// Check if there's an 'id' option which is a common mistake (instead of 'from')
			if (
				process.argv.includes('--id') ||
				process.argv.some((arg) => arg.startsWith('--id='))
			) {
				console.error(
					chalk.red(`Error: The update command uses --from=<${isJiraEnabled ? 'key' : 'id'}>, not --id=<id>`)
				);
				console.log(chalk.yellow(`\nTo update multiple ${isJiraEnabled ? 'Jira issues' : 'tasks'}:`));
				if (isJiraEnabled) {
					console.log(
						`  task-master update --from=PROJ-123 --prompt="Your prompt here"`
					);
					console.log(
						`  task-master update --from=PROJ-123,PROJ-124,PROJ-125 --prompt="Your prompt here"`
					);
				} else {
					console.log(
						`  task-master update --from=1 --prompt="Your prompt here"`
					);
				}
				console.log(
					chalk.yellow(
						`\nTo update a single specific ${isJiraEnabled ? 'Jira issue' : 'task'}, use the update-task command instead:`
					)
				);
				console.log(
					`  task-master update-task --id=${isJiraEnabled ? 'PROJ-123' : '<id>'} --prompt="Your prompt here"`
				);
				process.exit(1);
			}

			if (!prompt) {
				console.error(
					chalk.red(
						'Error: --prompt parameter is required. Please provide information about the changes.'
					)
				);
				process.exit(1);
			}

			if (isJiraEnabled) {
				// Jira mode
				const fromKey = options.from;
				const parentKey = options.parentKey;
				
				// Determine if we're dealing with a single issue or multiple issues
				const issueIds = fromKey && fromKey.includes(',') 
					? fromKey.split(',').map(key => key.trim()) 
					: fromKey;
				
				// Validate Jira key format if provided
				if (fromKey && fromKey !== '1') {
					if (Array.isArray(issueIds)) {
						// Check each issue ID in the array
						for (const id of issueIds) {
							if (!id.includes('-')) {
								console.error(
									chalk.red(
										`Error: Invalid Jira issue key format for "${id}". Keys should be in the format "PROJ-123"`
									)
								);
								process.exit(1);
							}
						}
					} else if (!fromKey.includes('-')) {
						// Check a single issue ID
						console.error(
							chalk.red(
								'Error: When Jira is enabled, the --from parameter should be a Jira issue key (e.g., PROJ-123)'
							)
						);
						process.exit(1);
					}
				}

				console.log(
					chalk.blue(
						parentKey 
							? `Updating Jira issues from parent ${parentKey} with prompt: "${prompt}"`
							: (Array.isArray(issueIds)
								? `Updating ${issueIds.length} Jira issues with prompt: "${prompt}"`
								: `Updating Jira issue ${fromKey} with prompt: "${prompt}"`)
					)
				);

				if (useResearch) {
					console.log(
						chalk.blue('Using Perplexity AI for research-backed Jira issue updates')
					);
				}

				try {
					// If parentKey is provided, pass it directly
					if (parentKey) {
						await updateJiraIssues(parentKey, prompt, useResearch, { log });
					} else {
						// Otherwise, pass the issue IDs (either a single ID or an array of IDs)
						await updateJiraIssues(issueIds, prompt, useResearch, { log });
					}
				} catch (error) {
					console.error(chalk.red(`Error updating Jira issues: ${error.message}`));
					if (CONFIG.debug) {
						console.error(error);
					}
					process.exit(1);
				}
			} else {
				// Local mode
				const tasksPath = options.file;
				const fromId = parseInt(options.from, 10);

				if (isNaN(fromId)) {
					console.error(
						chalk.red(
							'Error: When Jira is not enabled, the --from parameter should be a numeric ID'
						)
					);
					process.exit(1);
				}

				console.log(
					chalk.blue(
						`Updating tasks from ID >= ${fromId} with prompt: "${prompt}"`
					)
				);
				console.log(chalk.blue(`Tasks file: ${tasksPath}`));

				if (useResearch) {
					console.log(
						chalk.blue('Using Perplexity AI for research-backed task updates')
					);
				}

				await updateTasks(tasksPath, fromId, prompt, useResearch);
			}
		});

	// update-task command
	programInstance
		.command('update-task')
		.description(
			'Update a single specific task by ID with new information (use --id parameter)'
		)
		.option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
		.option(
			'-i, --id <id>', 
			() => JiraClient.isJiraEnabled() 
				? 'Jira issue key to update (e.g., "PROJ-123")' 
				: 'Task ID to update (required)'
		)
		.option(
			'-p, --prompt <text>',
			'Prompt explaining the changes or new context (required)'
		)
		.option(
			'-r, --research',
			'Use Perplexity AI for research-backed task updates'
		)
		.action(async (options) => {
			try {
				const isJiraEnabled = JiraClient.isJiraEnabled();
				const tasksPath = options.file;
				const prompt = options.prompt;
				const useResearch = options.research || false;

				// Validate required parameters
				if (!options.id) {
					console.error(chalk.red('Error: --id parameter is required'));
					console.log(
						chalk.yellow(
							`Usage example: task-master update-task --id=${isJiraEnabled ? 'PROJ-123' : '23'} --prompt="Update with new information"`
						)
					);
					process.exit(1);
				}

				if (!prompt) {
					console.error(
						chalk.red(
							'Error: --prompt parameter is required. Please provide information about the changes.'
						)
					);
					console.log(
						chalk.yellow(
							`Usage example: task-master update-task --id=${isJiraEnabled ? 'PROJ-123' : '23'} --prompt="Update with new information"`
						)
					);
					process.exit(1);
				}

				if (isJiraEnabled) {
					// Jira mode
					const issueKey = options.id;
					
					// Validate Jira key format
					if (!issueKey.includes('-')) {
						console.error(
							chalk.red(`Error: Invalid Jira issue key format. The key should be in the format "PROJ-123"`)
						);
						process.exit(1);
					}

					console.log(chalk.blue(`Updating Jira issue ${issueKey} with prompt: "${prompt}"`));

					if (useResearch) {
						console.log(chalk.blue('Using Perplexity AI for research-backed Jira issue update'));
					}

					try {
						// Call the updateJiraIssues function with the single issue ID
						await updateJiraIssues(issueKey, prompt, useResearch, { log });
					} catch (error) {
						console.error(chalk.red(`Error updating Jira issue: ${error.message}`));
						if (CONFIG.debug) {
							console.error(error);
						}
						process.exit(1);
					}
				} else {
					// Local mode - Parse the task ID and validate it's a number
					const taskId = parseInt(options.id, 10);
					if (isNaN(taskId) || taskId <= 0) {
						console.error(
							chalk.red(
								`Error: Invalid task ID: ${options.id}. Task ID must be a positive integer.`
							)
						);
						console.log(
							chalk.yellow(
								'Usage example: task-master update-task --id=23 --prompt="Update with new information"'
							)
						);
						process.exit(1);
					}

					// Validate tasks file exists
					if (!fs.existsSync(tasksPath)) {
						console.error(
							chalk.red(`Error: Tasks file not found at path: ${tasksPath}`)
						);
						if (tasksPath === 'tasks/tasks.json') {
							console.log(
								chalk.yellow(
									'Hint: Run task-master init or task-master parse-prd to create tasks.json first'
								)
							);
						} else {
							console.log(
								chalk.yellow(
									`Hint: Check if the file path is correct: ${tasksPath}`
								)
							);
						}
						process.exit(1);
					}

					console.log(
						chalk.blue(`Updating task ${taskId} with prompt: "${prompt}"`)
					);
					console.log(chalk.blue(`Tasks file: ${tasksPath}`));

					if (useResearch) {
						// Verify Perplexity API key exists if using research
						if (!process.env.PERPLEXITY_API_KEY) {
							console.log(
								chalk.yellow(
									'Warning: PERPLEXITY_API_KEY environment variable is missing. Research-backed updates will not be available.'
								)
							);
							console.log(
								chalk.yellow('Falling back to Claude AI for task update.')
							);
						} else {
							console.log(
								chalk.blue('Using Perplexity AI for research-backed task update')
							);
						}
					}

					const result = await updateTaskById(
						tasksPath,
						taskId,
						prompt,
						useResearch
					);

					// If the task wasn't updated (e.g., if it was already marked as done)
					if (!result) {
						console.log(
							chalk.yellow(
								'\nTask update was not completed. Review the messages above for details.'
							)
						);
					}
				}
			} catch (error) {
				console.error(chalk.red(`Error: ${error.message}`));

				// Provide more helpful error messages for common issues
				if (
					error.message.includes('task') &&
					error.message.includes('not found')
				) {
					console.log(chalk.yellow('\nTo fix this issue:'));
					console.log(
						'  1. Run task-master list to see all available task IDs'
					);
					console.log('  2. Use a valid task ID with the --id parameter');
				} else if (error.message.includes('API key')) {
					console.log(
						chalk.yellow(
							'\nThis error is related to API keys. Check your environment variables.'
						)
					);
				}

				if (CONFIG.debug) {
					console.error(error);
				}

				process.exit(1);
			}
		});

	// update-subtask command
	programInstance
		.command('update-subtask')
		.description(
			'Update a subtask by appending additional timestamped information'
		)
		.option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
		.option(
			'-i, --id <id>',
			() => JiraClient.isJiraEnabled() 
				? 'Jira issue key of the subtask to update (e.g., "PROJ-456")' 
				: 'Subtask ID to update in format "parentId.subtaskId" (required)'
		)
		.option(
			'--parent-key <key>',
			() => JiraClient.isJiraEnabled()
				? 'Parent Jira issue key (only needed for context or if issue key is ambiguous)'
				: 'Parent Jira issue key (only used when Jira is enabled)'
		)
		.option(
			'-p, --prompt <text>',
			'Prompt explaining what information to add (required)'
		)
		.option('-r, --research', 'Use Perplexity AI for research-backed updates')
		.action(async (options) => {
			try {
				const isJiraEnabled = JiraClient.isJiraEnabled();
				const tasksPath = options.file;
				const prompt = options.prompt;
				const useResearch = options.research || false;

				// Validate required parameters
				if (!options.id) {
					console.error(chalk.red('Error: --id parameter is required'));
					console.log(
						chalk.yellow(
							`Usage example: task-master update-subtask --id=${isJiraEnabled ? 'PROJ-456' : '5.2'} --prompt="Add more details about the API endpoint"`
						)
					);
					process.exit(1);
				}

				if (!prompt) {
					console.error(
						chalk.red(
							'Error: --prompt parameter is required. Please provide information to add to the subtask.'
						)
					);
					console.log(
						chalk.yellow(
							`Usage example: task-master update-subtask --id=${isJiraEnabled ? 'PROJ-456' : '5.2'} --prompt="Add more details about the API endpoint"`
						)
					);
					process.exit(1);
				}

				if (isJiraEnabled) {
					// Jira mode
					const subtaskKey = options.id;
					const parentKey = options.parentKey;
					
					// Validate Jira key format
					if (!subtaskKey.includes('-')) {
						console.error(
							chalk.red(`Error: Invalid Jira issue key format. The key should be in the format "PROJ-123"`)
						);
						process.exit(1);
					}

					console.log(chalk.blue(`Updating Jira subtask ${subtaskKey} with prompt: "${prompt}"`));
					
					if (parentKey) {
						console.log(chalk.blue(`Parent issue: ${parentKey}`));
					}

					if (useResearch) {
						console.log(chalk.blue('Using Perplexity AI for research-backed Jira subtask update'));
					}

					try {
						// For Jira, we need to use the updateJiraSubtask function from Jira utilities
						// Check if this subtask already has a direct function wrapper in the code
						// For now, we'll call updateJiraIssues with the single subtask ID, 
						// and any parent key context if available
						await updateJiraIssues(subtaskKey, prompt, useResearch, { log, parentKey });
					} catch (error) {
						console.error(chalk.red(`Error updating Jira subtask: ${error.message}`));
						if (CONFIG.debug) {
							console.error(error);
						}
						process.exit(1);
					}
				} else {
					// Local mode
					// Validate subtask ID format (should contain a dot)
					const subtaskId = options.id;
					if (!subtaskId.includes('.')) {
						console.error(
							chalk.red(
								`Error: Invalid subtask ID format: ${subtaskId}. Subtask ID must be in format "parentId.subtaskId"`
							)
						);
						console.log(
							chalk.yellow(
								'Usage example: task-master update-subtask --id=5.2 --prompt="Add more details about the API endpoint"'
							)
						);
						process.exit(1);
					}

					// Validate tasks file exists
					if (!fs.existsSync(tasksPath)) {
						console.error(
							chalk.red(`Error: Tasks file not found at path: ${tasksPath}`)
						);
						if (tasksPath === 'tasks/tasks.json') {
							console.log(
								chalk.yellow(
									'Hint: Run task-master init or task-master parse-prd to create tasks.json first'
								)
							);
						} else {
							console.log(
								chalk.yellow(
									`Hint: Check if the file path is correct: ${tasksPath}`
								)
							);
						}
						process.exit(1);
					}

					console.log(
						chalk.blue(`Updating subtask ${subtaskId} with prompt: "${prompt}"`)
					);
					console.log(chalk.blue(`Tasks file: ${tasksPath}`));

					if (useResearch) {
						// Verify Perplexity API key exists if using research
						if (!process.env.PERPLEXITY_API_KEY) {
							console.log(
								chalk.yellow(
									'Warning: PERPLEXITY_API_KEY environment variable is missing. Research-backed updates will not be available.'
								)
							);
							console.log(
								chalk.yellow('Falling back to Claude AI for subtask update.')
							);
						} else {
							console.log(
								chalk.blue(
									'Using Perplexity AI for research-backed subtask update'
								)
							);
						}
					}

					const result = await updateSubtaskById(
						tasksPath,
						subtaskId,
						prompt,
						useResearch
					);

					if (!result) {
						console.log(
							chalk.yellow(
								'\nSubtask update was not completed. Review the messages above for details.'
							)
						);
					}
				}
			} catch (error) {
				console.error(chalk.red(`Error: ${error.message}`));

				// Provide more helpful error messages for common issues
				if (
					error.message.includes('subtask') &&
					error.message.includes('not found')
				) {
					console.log(chalk.yellow('\nTo fix this issue:'));
					console.log(
						'  1. Run task-master list --with-subtasks to see all available subtask IDs'
					);
					console.log(
						'  2. Use a valid subtask ID with the --id parameter in format "parentId.subtaskId"'
					);
				} else if (error.message.includes('API key')) {
					console.log(
						chalk.yellow(
							'\nThis error is related to API keys. Check your environment variables.'
						)
					);
				}

				if (CONFIG.debug) {
					console.error(error);
				}

				process.exit(1);
			}
		});

	// generate command
	programInstance
		.command('generate')
		.description('Generate task files from tasks.json')
		.option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
		.option('-o, --output <dir>', 'Output directory', 'tasks')
		.action(async (options) => {
			const tasksPath = options.file;
			const outputDir = options.output;

			console.log(chalk.blue(`Generating task files from: ${tasksPath}`));
			console.log(chalk.blue(`Output directory: ${outputDir}`));

			await generateTaskFiles(tasksPath, outputDir);
		});

	// set-status command
	programInstance
		.command('set-status')
		.description(() => JiraClient.isJiraEnabled() 
			? 'Set the status of a Jira issue' 
			: 'Set the status of a task')
		.option(
			'-i, --id <id>',
			() => JiraClient.isJiraEnabled()
				? 'Jira issue key(s) to update (e.g., "PROJ-123" or "PROJ-123,PROJ-124")'
				: 'Task ID (can be comma-separated for multiple tasks)'
		)
		.option(
			'-s, --status <status>',
			 () => JiraClient.isJiraEnabled()
				? 'New status (e.g., "To Do", "In Progress", "Done")'
				: 'New status (todo, in-progress, review, done)'
		)
		.option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
		.action(async (options) => {
			const tasksPath = options.file;
			const taskId = options.id;
			const status = options.status;

			if (!taskId || !status) {
				console.error(chalk.red('Error: Both --id and --status are required'));
				process.exit(1);
			}

			const isJiraEnabled = JiraClient.isJiraEnabled();
			console.log(
				chalk.blue(`Setting status of ${isJiraEnabled ? 'Jira issue' : 'task'}(s) ${taskId} to: ${status}`)
			);

			try {
				if (isJiraEnabled) {
					// For Jira, pass appropriate parameters including log for consistent output
					const result = await setJiraTaskStatus(taskId, status, { 
						log: {
							info: (msg) => console.log(chalk.blue(msg)),
							warn: (msg) => console.log(chalk.yellow(msg)),
							error: (msg) => console.error(chalk.red(msg))
						}
					});
					
					if (!result.success) {
						console.error(chalk.red(`Error: ${result.error.message}`));
						process.exit(1);
					}
				} else {
					// For local tasks, use the existing function
					await setTaskStatus(tasksPath, taskId, status);
				}
			} catch (error) {
				console.error(chalk.red(`Error: ${error.message}`));
				process.exit(1);
			}
		});

	// list command
	programInstance
		.command('list')
		.description('List all tasks')
		.option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
		.option('-s, --status <status>', 'Filter by status')
		.option('--with-subtasks', 'Show subtasks for each task')
		.option('--parent-key <key>', 'Parent Jira issue key')
		.action(async (options) => {
			const tasksPath = options.file;
			const statusFilter = options.status;
			const withSubtasks = options.withSubtasks || false;
			const parentKey = options.parentKey;

			console.log(chalk.blue(`Listing tasks from ${JiraClient.isJiraEnabled() ? 'Jira' : 'local file'}: ${JiraClient.isJiraEnabled() ? parentKey : tasksPath}`));
			if (statusFilter) {
				console.log(chalk.blue(`Filtering by status: ${statusFilter}`));
			}
			if (withSubtasks) {
				console.log(chalk.blue('Including subtasks in listing'));
			}

			await listTasks(tasksPath, statusFilter, withSubtasks, { parentKey });
		});

	// expand command
	programInstance
		.command('expand')
		.description(() => JiraClient.isJiraEnabled() 
			? 'Break down Jira issues into detailed subtasks' 
			: 'Break down tasks into detailed subtasks')
		.option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
		.option(
			'-i, --id <id>',
			 () => JiraClient.isJiraEnabled()
				? 'Jira issue key to expand (e.g., "PROJ-123")'
				: 'Task ID to expand'
		)
		.option('-a, --all', 'Expand all tasks')
		.option(
			'-n, --num <number>',
			'Number of subtasks to generate',
			CONFIG.defaultSubtasks.toString()
		)
		.option(
			'--research',
			'Enable Perplexity AI for research-backed subtask generation'
		)
		.option(
			'-p, --prompt <text>',
			'Additional context to guide subtask generation'
		)
		.option(
			'--force',
			'Force regeneration of subtasks for tasks that already have them'
		)
		.option(
			'--parent-key <key>',
			() => JiraClient.isJiraEnabled()
				? 'Parent Jira issue key to filter tasks by (only used with --all)'
				: 'Parent Jira issue key (only used when Jira is enabled with --all)'
		)
		.action(async (options) => {
			const idArg = options.id;
			const numSubtasks = options.num || CONFIG.defaultSubtasks;
			const useResearch = options.research || false;
			const additionalContext = options.prompt || '';
			const forceFlag = options.force || false;
			const tasksPath = options.file || 'tasks/tasks.json';
			const parentKey = options.parentKey;
			const isJiraEnabled = JiraClient.isJiraEnabled();

			try {
				if (options.all) {
					console.log(
						chalk.blue(`Expanding all ${isJiraEnabled ? 'Jira issues' : 'tasks'} with ${numSubtasks} subtasks each...`)
					);
					if (isJiraEnabled && parentKey) {
						console.log(
							chalk.blue(`Filtering by parent issue: ${parentKey}`)
						);
					}
					if (useResearch) {
						console.log(
							chalk.blue(
								'Using Perplexity AI for research-backed subtask generation'
							)
						);
					} else {
						console.log(
							chalk.yellow('Research-backed subtask generation disabled')
						);
					}
					if (additionalContext) {
						console.log(chalk.blue(`Additional context: "${additionalContext}"`));
					}
					
					if (isJiraEnabled) {
						// Import the expandAllJiraTasks function
						const { expandAllJiraTasksDirect } = await import('../../mcp-server/src/core/direct-functions/expand-all-tasks.js');
						
						// Call the Jira implementation
						const result = await expandAllJiraTasksDirect(
							{
								parentKey,
								num: numSubtasks,
								research: useResearch,
								prompt: additionalContext,
								force: forceFlag
							},
							{
								info: (msg) => console.log(chalk.blue(msg)),
								warn: (msg) => console.log(chalk.yellow(msg)),
								error: (msg) => console.error(chalk.red(msg))
							},
							{}
						);
						
						if (!result.success) {
							console.error(chalk.red(`Error: ${result.error.message}`));
							process.exit(1);
						}
						
						console.log(chalk.green(`Successfully expanded ${result.data.tasksExpanded} Jira issues with ${result.data.subtasksCreated} total subtasks`));
					} else {
						// Use the local implementation
						await expandAllTasks(
							tasksPath,
							numSubtasks,
							useResearch,
							additionalContext,
							forceFlag
						);
					}
				} else if (idArg) {
					console.log(
						chalk.blue(`Expanding ${isJiraEnabled ? 'Jira issue' : 'task'} ${idArg} with ${numSubtasks} subtasks...`)
					);
					if (useResearch) {
						console.log(
							chalk.blue(
								'Using Perplexity AI for research-backed subtask generation'
							)
						);
					} else {
						console.log(
							chalk.yellow('Research-backed subtask generation disabled')
						);
					}
					if (additionalContext) {
						console.log(chalk.blue(`Additional context: "${additionalContext}"`));
					}
					
					if (isJiraEnabled) {
						// Import the expandJiraTask function
						const { expandJiraTaskDirect } = await import('../../mcp-server/src/core/direct-functions/expand-task.js');
						
						// Call the Jira implementation
						const result = await expandJiraTaskDirect(
							{
								id: idArg,
								num: numSubtasks,
								research: useResearch,
								prompt: additionalContext,
								force: forceFlag
							},
							{
								info: (msg) => console.log(chalk.blue(msg)),
								warn: (msg) => console.log(chalk.yellow(msg)),
								error: (msg) => console.error(chalk.red(msg))
							},
							{ session: process.env }
						);
						
						if (!result.success) {
							console.error(chalk.red(`Error: ${result.error.message}`));
							process.exit(1);
						}
						
						console.log(chalk.green(`Successfully created ${result.data.subtasksCount} subtasks for Jira issue ${idArg}`));
					} else {
						// Use the local implementation
						await expandTask(
							tasksPath,
							idArg,
							numSubtasks,
							useResearch,
							additionalContext,
							forceFlag
						);
					}
				} else {
					console.error(
						chalk.red(
							`Error: Please specify a ${isJiraEnabled ? 'Jira issue key' : 'task ID'} with --id=<${isJiraEnabled ? 'key' : 'id'}> or use --all to expand all ${isJiraEnabled ? 'issues' : 'tasks'}.`
						)
					);
					process.exit(1);
				}
			} catch (error) {
				console.error(chalk.red(`Error: ${error.message}`));
				process.exit(1);
			}
		});

	// analyze-complexity command
	programInstance
		.command('analyze-complexity')
		.description(() => JiraClient.isJiraEnabled() 
			? 'Analyze Jira issues and generate expansion recommendations' 
			: 'Analyze tasks and generate expansion recommendations')
		.option(
			'-o, --output <file>',
			'Output file path for the report',
			'scripts/task-complexity-report.json'
		)
		.option(
			'-m, --model <model>',
			'LLM model to use for analysis (defaults to configured model)'
		)
		.option(
			'-t, --threshold <number>',
			'Minimum complexity score to recommend expansion (1-10)',
			'5'
		)
		.option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
		.option(
			'-r, --research',
			'Use Perplexity AI for research-backed complexity analysis'
		)
		.option(
			'--parent-key <key>',
			() => JiraClient.isJiraEnabled()
				? 'Parent Jira issue key to filter tasks by'
				: 'Parent Jira issue key (only used when Jira is enabled)'
		)
		.action(async (options) => {
			const tasksPath = options.file || 'tasks/tasks.json';
			const outputPath = options.output;
			const modelOverride = options.model;
			const thresholdScore = parseFloat(options.threshold);
			const useResearch = options.research || false;
			const parentKey = options.parentKey;
			const isJiraEnabled = JiraClient.isJiraEnabled();

			if (isJiraEnabled) {
				// Jira mode
				console.log(chalk.blue(`Analyzing Jira issue complexity${parentKey ? ` from parent ${parentKey}` : ''}`));
				console.log(chalk.blue(`Output report will be saved to: ${outputPath}`));

				if (useResearch) {
					console.log(
						chalk.blue(
							'Using Perplexity AI for research-backed complexity analysis'
						)
					);
				}

				try {
					// Import and call analyzeJiraComplexityDirect
					const { analyzeJiraComplexityDirect } = await import('../../mcp-server/src/core/direct-functions/analyze-task-complexity.js');
					
					const result = await analyzeJiraComplexityDirect(
						{
							parentKey,
							outputPath,
							model: modelOverride,
							threshold: thresholdScore,
							research: useResearch
						},
						{
							info: (msg) => console.log(chalk.blue(msg)),
							warn: (msg) => console.log(chalk.yellow(msg)),
							error: (msg) => console.error(chalk.red(msg))
						},
						{ session: process.env }
					);
					
					if (!result.success) {
						console.error(chalk.red(`Error: ${result.error.message}`));
						process.exit(1);
					}
					
					console.log(chalk.green(result.data.message));
					
					// Display summary of the analysis
					const summary = result.data.reportSummary;
					if (summary) {
						console.log(chalk.green(`\nAnalysis Summary:`));
						console.log(chalk.white(`Total issues analyzed: ${summary.taskCount}`));
						console.log(chalk.red(`High complexity issues (8-10): ${summary.highComplexityTasks}`));
						console.log(chalk.yellow(`Medium complexity issues (5-7): ${summary.mediumComplexityTasks}`));
						console.log(chalk.green(`Low complexity issues (1-4): ${summary.lowComplexityTasks}`));
						console.log(chalk.blue(`\nRun 'task-master complexity-report' to see the full report`));
					}
				} catch (error) {
					console.error(chalk.red(`Error analyzing Jira issue complexity: ${error.message}`));
					if (CONFIG.debug) {
						console.error(error);
					}
					process.exit(1);
				}
			} else {
				// Local mode (original implementation)
				console.log(chalk.blue(`Analyzing task complexity from: ${tasksPath}`));
				console.log(chalk.blue(`Output report will be saved to: ${outputPath}`));

				if (useResearch) {
					console.log(
						chalk.blue(
							'Using Perplexity AI for research-backed complexity analysis'
						)
					);
				}

				await analyzeTaskComplexity(options);
			}
		});

	// clear-subtasks command
	programInstance
		.command('clear-subtasks')
		.description(() => JiraClient.isJiraEnabled() 
			? 'Clear subtasks from Jira parent issues' 
			: 'Clear subtasks from specified tasks')
		.option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
		.option(
			'-i, --id <ids>',
			() => JiraClient.isJiraEnabled() 
				? 'Jira issue key to clear subtasks from' 
				: 'Task IDs (comma-separated) to clear subtasks from'
		)
		.option(
			'--parent-key <key>',
			() => JiraClient.isJiraEnabled()
				? 'Parent Jira issue key to clear subtasks from'
				: 'Parent Jira issue key (only used when Jira is enabled)'
		)
		.option('--all', 'Clear subtasks from all tasks')
		.action(async (options) => {
			const tasksPath = options.file;
			const taskIds = options.id;
			const all = options.all;
			const parentKey = options.parentKey;
			const isJiraEnabled = JiraClient.isJiraEnabled();

			if (!taskIds && !all && !parentKey) {
				console.error(
					chalk.red(
						`Error: Please specify ${isJiraEnabled ? 'a Jira issue key' : 'task IDs'} with --id=<${isJiraEnabled ? 'key' : 'ids'}> or --parent-key=<key> or use --all to clear all ${isJiraEnabled ? 'issues' : 'tasks'}`
					)
				);
				process.exit(1);
			}
			
			if (isJiraEnabled) {
				// Jira mode
				try {
					// Import the clearJiraSubtasksDirect function
					const { clearJiraSubtasksDirect } = await import('../../mcp-server/src/core/direct-functions/clear-subtasks.js');
					
					// Create a logger for the direct function
					const log = {
						info: (msg) => console.log(chalk.blue(msg)),
						warn: (msg) => console.log(chalk.yellow(msg)),
						error: (msg) => console.error(chalk.red(msg))
					};
					
					// Call the direct function
					const result = await clearJiraSubtasksDirect(
						{ 
							parentKey: parentKey || taskIds, // Use either parentKey or taskIds as the Jira parent key
							all 
						},
						log,
						{ session: process.env }
					);
					
					if (!result.success) {
						console.error(chalk.red(`Error: ${result.error.message}`));
						process.exit(1);
					}
					
					console.log(chalk.green(result.data.message));
					
					// Display summary of cleared subtasks
					if (result.data.results && result.data.results.length > 0) {
						result.data.results.forEach(parent => {
							console.log(chalk.blue(`Parent ${parent.parentKey}: ${parent.title}`));
							console.log(chalk.blue(`Subtasks removed: ${parent.subtasksRemoved}`));
							
							if (parent.subtasks && parent.subtasks.length > 0) {
								parent.subtasks.forEach(subtask => {
									const statusColor = subtask.status === 'removed' ? chalk.green : chalk.red;
									console.log(`  ${statusColor(`${subtask.key}: ${subtask.title} (${subtask.status})`)}`);
									if (subtask.error) {
										console.log(`    ${chalk.red(`Error: ${subtask.error.message}`)}`);
									}
								});
							}
							console.log();
						});
					}
				} catch (error) {
					console.error(chalk.red(`Error clearing Jira subtasks: ${error.message}`));
					if (CONFIG.debug) {
						console.error(error);
					}
					process.exit(1);
				}
			} else {
				// Local mode - use the existing implementation
				if (all) {
					// If --all is specified, get all task IDs
					const data = readJSON(tasksPath);
					if (!data || !data.tasks) {
						console.error(chalk.red('Error: No valid tasks found'));
						process.exit(1);
					}
					const allIds = data.tasks.map((t) => t.id).join(',');
					clearSubtasks(tasksPath, allIds);
				} else {
					clearSubtasks(tasksPath, taskIds);
				}
			}
		});

	// add-task command
	programInstance
		.command('add-task')
		.description(() => JiraClient.isJiraEnabled() 
			? 'Add a new Jira issue' 
			: 'Add a new task using AI or manual input')
		.option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
		.option(
			'-p, --prompt <prompt>',
			() => JiraClient.isJiraEnabled()
				? 'Description of the Jira issue to add (alternative to manual fields)'
				: 'Description of the task to add (required if not using manual fields)'
		)
		.option(
			'-t, --title <title>',
			() => JiraClient.isJiraEnabled()
				? 'Title/summary for the Jira issue (required for manual creation)'
				: 'Task title (for manual task creation)'
		)
		.option(
			'-d, --description <description>',
			'Task/issue description (for manual creation)'
		)
		.option(
			'--details <details>',
			'Implementation details (for manual creation)'
		)
		.option(
			'--test-strategy <testStrategy>',
			'Test strategy (for manual creation)'
		)
		.option(
			'--acceptance-criteria <criteria>',
			() => JiraClient.isJiraEnabled()
				? 'Acceptance criteria for the Jira issue'
				: 'Acceptance criteria (for manual task creation)'
		)
		.option(
			'--dependencies <dependencies>',
			() => JiraClient.isJiraEnabled()
				? 'Not applicable for Jira issues - use add-dependency command'
				: 'Comma-separated list of task IDs this task depends on'
		)
		.option(
			'--priority <priority>',
			() => JiraClient.isJiraEnabled()
				? 'Jira priority (e.g., "Medium", "High")'
				: 'Task priority (high, medium, low)',
			'medium'
		)
		.option(
			'-r, --research',
			'Whether to use research capabilities for task/issue creation'
		)
		.option(
			'--parent-key <key>',
			() => JiraClient.isJiraEnabled()
				? 'Parent Jira issue key to link this issue to (e.g., "PROJ-123")'
				: 'Parent Jira issue key (only used when Jira is enabled)'
		)
		.option(
			'--issue-type <type>',
			() => JiraClient.isJiraEnabled()
				? 'Jira issue type (e.g., "Task", "Story", "Bug")'
				: 'Jira issue type (only used when Jira is enabled)',
			'Task'
		)
		.option(
			'--assignee <assignee>',
			() => JiraClient.isJiraEnabled()
				? 'Jira account ID or email of the assignee'
				: 'Jira assignee (only used when Jira is enabled)'
		)
		.option(
			'--labels <labels>',
			() => JiraClient.isJiraEnabled()
				? 'Comma-separated list of labels to add to the Jira issue'
				: 'Jira labels (only used when Jira is enabled)'
		)
		.action(async (options) => {
			const isJiraEnabled = JiraClient.isJiraEnabled();
			const isManualCreation = options.title && options.description;

			// Validate that either prompt or title+description are provided
			if (!options.prompt && !isManualCreation) {
				console.error(
					chalk.red(
						'Error: Either --prompt or both --title and --description must be provided'
					)
				);
				process.exit(1);
			}

			try {
				if (isJiraEnabled) {
					// Import the addJiraTaskDirect function
					const { addJiraTaskDirect } = await import('../../mcp-server/src/core/direct-functions/add-task.js');
					
					// Prepare labels if provided
					let labels = [];
					if (options.labels) {
						labels = options.labels.split(',').map(label => label.trim());
					}
					
					// Prepare args for Jira task creation
					const args = {
						title: options.title || '',
						description: options.description || '',
						details: options.details || '',
						testStrategy: options.testStrategy || '',
						acceptanceCriteria: options.acceptanceCriteria || '',
						parentKey: options.parentKey || null,
						priority: options.priority || 'medium',
						issueType: options.issueType || 'Task',
						assignee: options.assignee || null,
						labels: labels
					};
					
					// If prompt is provided without manual details, use AI to generate
					if (options.prompt && !isManualCreation) {
						console.log(chalk.blue(`Creating Jira issue with AI using prompt: "${options.prompt}"`));
						// For prompt-based creation, need to implement AI-based Jira task creation
						// For now, we'll just report that this isn't implemented yet
						console.error(chalk.yellow('AI-based Jira issue creation is not yet implemented. Please use manual fields.'));
						process.exit(1);
					} else {
						console.log(chalk.blue(`Creating Jira issue manually with title: "${options.title}"`));
						if (options.parentKey) {
							console.log(chalk.blue(`Parent/Epic key: ${options.parentKey}`));
						}
						if (options.priority) {
							console.log(chalk.blue(`Priority: ${options.priority}`));
						}
						if (options.issueType) {
							console.log(chalk.blue(`Issue type: ${options.issueType}`));
						}
					}
					
					// Call the Jira implementation
					const result = await addJiraTaskDirect(
						args,
						{
							info: (msg) => console.log(chalk.blue(msg)),
							warn: (msg) => console.log(chalk.yellow(msg)),
							error: (msg) => console.error(chalk.red(msg))
						},
						{ session: process.env }
					);
					
					if (result.success) {
						console.log(chalk.green(`✓ Added new Jira issue ${result.data.key}`));
						console.log(chalk.gray('Next: Complete this issue or add more issues'));
					} else {
						console.error(chalk.red(`Error adding Jira issue: ${result.error.message}`));
						process.exit(1);
					}
				} else {
					// Original local task creation logic
					// Prepare dependencies if provided
					let dependencies = [];
					if (options.dependencies) {
						dependencies = options.dependencies
							.split(',')
							.map((id) => parseInt(id.trim(), 10));
					}

					// Create manual task data if title and description are provided
					let manualTaskData = null;
					if (isManualCreation) {
						manualTaskData = {
							title: options.title,
							description: options.description,
							details: options.details || '',
							testStrategy: options.testStrategy || ''
						};

						console.log(
							chalk.blue(`Creating task manually with title: "${options.title}"`)
						);
						if (dependencies.length > 0) {
							console.log(
								chalk.blue(`Dependencies: [${dependencies.join(', ')}]`)
							);
						}
						if (options.priority) {
							console.log(chalk.blue(`Priority: ${options.priority}`));
						}
					} else {
						console.log(
							chalk.blue(
								`Creating task with AI using prompt: "${options.prompt}"`
							)
						);
						if (dependencies.length > 0) {
							console.log(
								chalk.blue(`Dependencies: [${dependencies.join(', ')}]`)
							);
						}
						if (options.priority) {
							console.log(chalk.blue(`Priority: ${options.priority}`));
						}
					}

					const newTaskId = await addTask(
						options.file,
						options.prompt,
						dependencies,
						options.priority,
						{
							session: process.env
						},
						options.research || false,
						null,
						manualTaskData
					);

					console.log(chalk.green(`✓ Added new task #${newTaskId}`));
					console.log(chalk.gray('Next: Complete this task or add more tasks'));
				}
			} catch (error) {
				console.error(chalk.red(`Error adding task: ${error.message}`));
				if (error.stack && CONFIG.debug) {
					console.error(error.stack);
				}
				process.exit(1);
			}
		});

	// next command
	programInstance
		.command('next')
		.description(() => JiraClient.isJiraEnabled() 
			? `Find the next Jira issue to work on based on dependencies and status${chalk.reset('')}` 
			: `Show the next task to work on based on dependencies and status${chalk.reset('')}`
		)
		.option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
		.option(
			'--parent-key <key>',
			() => JiraClient.isJiraEnabled()
				? 'Parent Jira issue key to filter tasks by'
				: 'Parent Jira issue key (only used when Jira is enabled)'
		)
		.action(async (options) => {
			try {
				const isJiraEnabled = JiraClient.isJiraEnabled();
				
				if (isJiraEnabled) {
					// Import the nextJiraTaskDirect function
					const { nextJiraTaskDirect } = await import('../../mcp-server/src/core/direct-functions/next-task.js');
					
					// Call the Jira implementation
					const result = await nextJiraTaskDirect(
						{
							parentKey: options.parentKey
						},
						{
							info: (msg) => console.log(chalk.blue(msg)),
							warn: (msg) => console.log(chalk.yellow(msg)),
							error: (msg) => console.error(chalk.red(msg))
						}
					);
					
					if (!result.success) {
						console.error(chalk.red(`Error finding next Jira issue: ${result.error.message}`));
						process.exit(1);
					}
					
					if (!result.data.nextTask) {
						console.log(
							boxen(
								chalk.yellow('No eligible Jira issues found!\n\n') +
									'All pending issues have unsatisfied dependencies, or all issues are completed.',
								{
									padding: { top: 0, bottom: 0, left: 1, right: 1 },
									borderColor: 'yellow',
									borderStyle: 'round',
									margin: { top: 1 }
								}
							)
						);
						return;
					}
					
					// Display the Jira issue in a similar format to displayNextTask
					console.log(
						boxen(chalk.white.bold(`Next Issue: ${result.data.nextTask.id} - ${result.data.nextTask.title}`), {
							padding: { top: 0, bottom: 0, left: 1, right: 1 },
							borderColor: 'blue',
							borderStyle: 'round',
							margin: { top: 1, bottom: 0 }
						})
					);
					
					// Create a table with issue details (similar to task table)
					const issueTable = new Table({
						style: {
							head: [],
							border: [],
							'padding-top': 0,
							'padding-bottom': 0,
							compact: true
						},
						chars: {
							mid: '',
							'left-mid': '',
							'mid-mid': '',
							'right-mid': ''
						},
						colWidths: [15, Math.min(75, process.stdout.columns - 20 || 60)],
						wordWrap: true
					});
					
					// Add issue details to table
					issueTable.push(
						[chalk.cyan.bold('ID:'), result.data.nextTask.id],
						[chalk.cyan.bold('Title:'), result.data.nextTask.title],
						[chalk.cyan.bold('Status:'), result.data.nextTask.status || 'To Do'],
						[chalk.cyan.bold('Priority:'), result.data.nextTask.priority || 'Medium'],
						[chalk.cyan.bold('Description:'), result.data.nextTask.description || 'No description provided']
					);
					
					console.log(issueTable.toString());
					
					// Show details if they exist
					if (result.data.nextTask.details && result.data.nextTask.details.trim().length > 0) {
						console.log(
							boxen(
								chalk.white.bold('Implementation Details:') + '\n\n' + result.data.nextTask.details,
								{
									padding: { top: 0, bottom: 0, left: 1, right: 1 },
									borderColor: 'cyan',
									borderStyle: 'round',
									margin: { top: 1, bottom: 0 }
								}
							)
						);
					}
					
					// Show subtasks if they exist
					if (result.data.nextTask.subtasks && result.data.nextTask.subtasks.length > 0) {
						console.log(
							boxen(chalk.white.bold('Subtasks'), {
								padding: { top: 0, bottom: 0, left: 1, right: 1 },
								margin: { top: 1, bottom: 0 },
								borderColor: 'magenta',
								borderStyle: 'round'
							})
						);
						
						// Create a table for subtasks
						const subtaskTable = new Table({
							head: [
								chalk.magenta.bold('ID'),
								chalk.magenta.bold('Status'),
								chalk.magenta.bold('Title'),
								chalk.magenta.bold('Priority')
							],
							colWidths: [15, 15, 40, 15],
							style: {
								head: [],
								border: [],
								'padding-top': 0,
								'padding-bottom': 0,
								compact: true
							},
							wordWrap: true
						});
						
						// Add subtasks to table
						result.data.nextTask.subtasks.forEach((st) => {
							subtaskTable.push([
								st.id,
								st.status || 'To Do',
								st.title,
								st.priority || 'Medium'
							]);
						});
						
						console.log(subtaskTable.toString());
					}
					
					// Show suggested next steps
					console.log(
						boxen(
							chalk.white.bold('Suggested Actions:') + '\n\n' +
							`${chalk.cyan('1.')} Run ${chalk.yellow(`task-master set-status --id="${result.data.nextTask.id}" --status="In Progress"`)} to start working\n` +
							`${chalk.cyan('2.')} Run ${chalk.yellow(`task-master expand --id="${result.data.nextTask.id}"`)} to break this issue into subtasks`,
							{
								padding: { top: 0, bottom: 0, left: 1, right: 1 },
								borderColor: 'green',
								borderStyle: 'round',
								margin: { top: 1, bottom: 0 }
							}
						)
					);
				} else {
					const tasksPath = options.file;
					await displayNextTask(tasksPath);
				}
			} catch (error) {
				console.error(chalk.red(`Error: ${error.message}`));
				process.exit(1);
			}
		});

	// show command
	programInstance
		.command('show')
		.description(() => JiraClient.isJiraEnabled() 
			? `Display detailed information about a specific Jira issue${chalk.reset('')}` 
			: `Display detailed information about a specific task${chalk.reset('')}`
		)
		.argument('[id]', 'ID to show')
		.option(
			'-i, --id <id>', 
			() => JiraClient.isJiraEnabled() 
				? 'Jira issue key to show details for (e.g., "PROJ-123")' 
				: 'Task ID to show'
		)
		.option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
		.option(
			'--with-subtasks', 
			() => JiraClient.isJiraEnabled() 
				? 'Include subtasks in the Jira issue details' 
				: 'Include subtasks in the task details (default for tasks)',
			JiraClient.isJiraEnabled() ? false : true
		)
		.action(async (taskId, options) => {
			try {
				const idArg = taskId || options.id;
				const isJiraEnabled = JiraClient.isJiraEnabled();

				if (!idArg) {
					console.error(chalk.red('Error: Please provide a task ID'));
					process.exit(1);
				}

				if (isJiraEnabled) {
					// Import the showJiraTask function
					const { showJiraTaskDirect } = await import('../../mcp-server/src/core/direct-functions/show-task.js');
					
					// Call the Jira implementation
					const result = await showJiraTaskDirect(
						{
							id: idArg,
							withSubtasks: options.withSubtasks
						},
						{
							info: (msg) => console.log(chalk.blue(msg)),
							warn: (msg) => console.log(chalk.yellow(msg)),
							error: (msg) => console.error(chalk.red(msg))
						}
					);

					if (!result.success) {
						console.error(chalk.red(`Error: ${result.error.message}`));
						process.exit(1);
					}

					const issue = result.data.task;
					
					// Create a table for the issue details
					const issueTable = new Table({
						style: {
							head: [],
							border: [],
							'padding-left': 1,
							'padding-right': 1
						},
						wordWrap: true
					});
					
					// Add issue details to the table
					issueTable.push(
						[chalk.cyan.bold('Issue Key:'), issue.id || idArg],
						[chalk.cyan.bold('Title:'), issue.title || issue.summary || 'No title'],
						[chalk.cyan.bold('Status:'), issue.status || 'To Do'],
						[chalk.cyan.bold('Priority:'), issue.priority || 'Medium'],
						[chalk.cyan.bold('Description:'), issue.description || 'No description provided']
					);
					
					console.log(issueTable.toString());
					
					// Show details if they exist
					if (issue.details && issue.details.trim().length > 0) {
						console.log(
							boxen(
								chalk.white.bold('Implementation Details:') + '\n\n' + issue.details,
								{
									padding: { top: 0, bottom: 0, left: 1, right: 1 },
									borderColor: 'cyan',
									borderStyle: 'round',
									margin: { top: 1, bottom: 0 }
								}
							)
						);
					}
					
					// Show subtasks if they exist
					if (issue.subtasks && issue.subtasks.length > 0) {
						console.log(
							boxen(chalk.white.bold('Subtasks'), {
								padding: { top: 0, bottom: 0, left: 1, right: 1 },
								margin: { top: 1, bottom: 0 },
								borderColor: 'magenta',
								borderStyle: 'round'
							})
						);
						
						// Create a table for subtasks
						const subtaskTable = new Table({
							head: [
								chalk.magenta.bold('ID'),
								chalk.magenta.bold('Status'),
								chalk.magenta.bold('Title'),
								chalk.magenta.bold('Priority')
							],
							colWidths: [15, 15, 40, 15],
							style: {
								head: [],
								border: [],
								'padding-top': 0,
								'padding-bottom': 0,
								compact: true
							},
							wordWrap: true
						});
						
						// Add subtasks to table
						issue.subtasks.forEach((st) => {
							subtaskTable.push([
								st.id,
								st.status || 'To Do',
								st.title,
								st.priority || 'Medium'
							]);
						});
						
						console.log(subtaskTable.toString());
					}
					
					// Show suggested next steps
					console.log(
						boxen(
							chalk.white.bold('Suggested Actions:') + '\n\n' +
							`${chalk.cyan('1.')} Run ${chalk.yellow(`task-master set-status --id="${issue.id}" --status="In Progress"`)} to start working\n` +
							`${chalk.cyan('2.')} Run ${chalk.yellow(`task-master expand --id="${issue.id}"`)} to break this issue into subtasks`,
							{
								padding: { top: 0, bottom: 0, left: 1, right: 1 },
								borderColor: 'green',
								borderStyle: 'round',
								margin: { top: 1, bottom: 0 }
							}
						)
					);
				} else {
					const tasksPath = options.file;
					await displayTaskById(tasksPath, idArg);
				}
			} catch (error) {
				console.error(chalk.red(`Error: ${error.message}`));
				process.exit(1);
			}
		});

	// add-dependency command
	programInstance
		.command('add-dependency')
		.description(() => JiraClient.isJiraEnabled() 
			? 'Add a dependency relationship between two Jira issues' 
			: 'Add a dependency to a task')
		.option(
			'-i, --id <id>', 
			() => JiraClient.isJiraEnabled()
				? 'Jira issue key that will depend on another issue (e.g., "PROJ-123")'
				: 'Task ID to add dependency to'
		)
		.option(
			'-d, --depends-on <id>', 
			() => JiraClient.isJiraEnabled()
				? 'Jira issue key that will become a dependency (e.g., "PROJ-456")'
				: 'Task ID that will become a dependency'
		)
		.option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
		.action(async (options) => {
			try {
				const isJiraEnabled = JiraClient.isJiraEnabled();
				const taskId = options.id;
				const dependencyId = options.dependsOn;

				if (!taskId || !dependencyId) {
					console.error(
						chalk.red('Error: Both --id and --depends-on are required')
					);
					process.exit(1);
				}

				if (isJiraEnabled) {
					// Import the addJiraDependencyDirect function
					const { addJiraDependencyDirect } = await import('../../mcp-server/src/core/direct-functions/add-dependency.js');
					
					// Call the Jira implementation
					const result = await addJiraDependencyDirect(
						{
							id: taskId,
							dependsOn: dependencyId
						},
						{
							info: (msg) => console.log(chalk.blue(msg)),
							warn: (msg) => console.log(chalk.yellow(msg)),
							error: (msg) => console.error(chalk.red(msg))
						},
						{ session: process.env }
					);
					
					if (result.success) {
						console.log(chalk.green(result.data.message));
					} else {
						console.error(chalk.red(`Error: ${result.error.message}`));
						process.exit(1);
					}
				} else {
					// Handle subtask IDs correctly by preserving the string format for IDs containing dots
					// Only use parseInt for simple numeric IDs
					const formattedTaskId = taskId.includes('.')
						? taskId
						: parseInt(taskId, 10);
					const formattedDependencyId = dependencyId.includes('.')
						? dependencyId
						: parseInt(dependencyId, 10);

					await addDependency(options.file, formattedTaskId, formattedDependencyId);
				}
			} catch (error) {
				console.error(chalk.red(`Error: ${error.message}`));
				process.exit(1);
			}
		});

	// remove-dependency command
	programInstance
		.command('remove-dependency')
		.description(() => JiraClient.isJiraEnabled() 
			? 'Remove a dependency relationship between two Jira issues' 
			: 'Remove a dependency from a task')
		.option(
			'-i, --id <id>', 
			() => JiraClient.isJiraEnabled()
				? 'Jira issue key to remove dependency from (e.g., "PROJ-123")'
				: 'Task ID to remove dependency from'
		)
		.option(
			'-d, --depends-on <id>', 
			() => JiraClient.isJiraEnabled()
				? 'Jira issue key to remove as a dependency (e.g., "PROJ-456")'
				: 'Task ID to remove as a dependency'
		)
		.option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
		.action(async (options) => {
			try {
				const isJiraEnabled = JiraClient.isJiraEnabled();
				const taskId = options.id;
				const dependencyId = options.dependsOn;

				if (!taskId || !dependencyId) {
					console.error(
						chalk.red('Error: Both --id and --depends-on are required')
					);
					process.exit(1);
				}

				if (isJiraEnabled) {
					// Import the removeJiraDependencyDirect function
					const { removeJiraDependencyDirect } = await import('../../mcp-server/src/core/direct-functions/remove-dependency.js');
					
					// Call the Jira implementation
					const result = await removeJiraDependencyDirect(
						{
							id: taskId,
							dependsOn: dependencyId
						},
						{
							info: (msg) => console.log(chalk.blue(msg)),
							warn: (msg) => console.log(chalk.yellow(msg)),
							error: (msg) => console.error(chalk.red(msg))
						},
						{ session: process.env }
					);
					
					if (result.success) {
						console.log(chalk.green(result.data.message));
					} else {
						console.error(chalk.red(`Error: ${result.error.message}`));
						process.exit(1);
					}
				} else {
					// Handle subtask IDs correctly by preserving the string format for IDs containing dots
					// Only use parseInt for simple numeric IDs
					const formattedTaskId = taskId.includes('.')
						? taskId
						: parseInt(taskId, 10);
					const formattedDependencyId = dependencyId.includes('.')
						? dependencyId
						: parseInt(dependencyId, 10);

					await removeDependency(options.file, formattedTaskId, formattedDependencyId);
				}
			} catch (error) {
				console.error(chalk.red(`Error: ${error.message}`));
				process.exit(1);
			}
		});

	// validate-dependencies command
	programInstance
		.command('validate-dependencies')
		.description(() => JiraClient.isJiraEnabled()
			? `Identify invalid dependencies in Jira issues without fixing them${chalk.reset('')}`
			: `Identify invalid dependencies without fixing them${chalk.reset('')}`
		)
		.option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
		.option(
			'--parent-key <key>',
			() => JiraClient.isJiraEnabled()
				? 'Parent Jira issue key to filter tasks by'
				: 'Parent Jira issue key (only used when Jira is enabled)'
		)
		.action(async (options) => {
			try {
				const isJiraEnabled = JiraClient.isJiraEnabled();
				
				if (isJiraEnabled) {
					// Import the validateJiraDependenciesDirect function
					const { validateJiraDependenciesDirect } = await import('../../mcp-server/src/core/direct-functions/validate-dependencies.js');
					
					// Call the Jira implementation
					const result = await validateJiraDependenciesDirect(
						{
							parentKey: options.parentKey
						},
						{
							info: (msg) => console.log(chalk.blue(msg)),
							warn: (msg) => console.log(chalk.yellow(msg)),
							error: (msg) => console.error(chalk.red(msg))
						},
						{ session: process.env }
					);
					
					if (result.success) {
						const validDependencies = result.data.validDependencies || [];
						const invalidDependencies = result.data.invalidDependencies || [];
						
						console.log(chalk.green(`✓ Found ${validDependencies.length} valid dependencies`));
						
						if (invalidDependencies.length > 0) {
							console.log(chalk.yellow(`⚠ Found ${invalidDependencies.length} invalid dependencies:`));
							invalidDependencies.forEach(issue => {
								console.log(chalk.yellow(` - ${issue.message || JSON.stringify(issue)}`));
							});
							console.log(chalk.blue('Run `task-master fix-dependencies` to automatically fix these issues.'));
						} else {
							console.log(chalk.green('No dependency issues found in Jira issues.'));
						}
					} else {
						console.error(chalk.red(`Error: ${result.error.message}`));
						process.exit(1);
					}
				} else {
					await validateDependenciesCommand(options.file);
				}
			} catch (error) {
				console.error(chalk.red(`Error: ${error.message}`));
				process.exit(1);
			}
		});

	// fix-dependencies command
	programInstance
		.command('fix-dependencies')
		.description(() => JiraClient.isJiraEnabled()
			? `Fix invalid dependencies in Jira issues automatically${chalk.reset('')}`
			: `Fix invalid dependencies automatically${chalk.reset('')}`
		)
		.option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
		.option(
			'--parent-key <key>',
			() => JiraClient.isJiraEnabled()
				? 'Parent Jira issue key to filter tasks by'
				: 'Parent Jira issue key (only used when Jira is enabled)'
		)
		.action(async (options) => {
			try {
				const isJiraEnabled = JiraClient.isJiraEnabled();
				
				if (isJiraEnabled) {
					// Import the fixJiraDependenciesDirect function
					const { fixJiraDependenciesDirect } = await import('../../mcp-server/src/core/direct-functions/fix-dependencies.js');
					
					// Call the Jira implementation
					const result = await fixJiraDependenciesDirect(
						{
							parentKey: options.parentKey
						},
						{
							info: (msg) => console.log(chalk.blue(msg)),
							warn: (msg) => console.log(chalk.yellow(msg)),
							error: (msg) => console.error(chalk.red(msg))
						},
						{ session: process.env }
					);
					
					if (result.success) {
						const fixedDependencies = result.data.fixedDependencies || [];
						const remainingIssues = result.data.remainingIssues || [];
						
						if (fixedDependencies.length > 0) {
							console.log(chalk.green(`✓ Fixed ${fixedDependencies.length} dependency issues:`));
							fixedDependencies.forEach(issue => {
								console.log(chalk.green(` - ${issue.message || JSON.stringify(issue)}`));
							});
						} else {
							console.log(chalk.green('No dependency issues needed to be fixed.'));
						}
						
						if (remainingIssues.length > 0) {
							console.log(chalk.yellow(`⚠ ${remainingIssues.length} dependency issues could not be automatically fixed:`));
							remainingIssues.forEach(issue => {
								console.log(chalk.yellow(` - ${issue.message || JSON.stringify(issue)}`));
							});
							console.log(chalk.blue('These issues may require manual intervention.'));
						}
					} else {
						console.error(chalk.red(`Error: ${result.error.message}`));
						process.exit(1);
					}
				} else {
					await fixDependenciesCommand(options.file);
				}
			} catch (error) {
				console.error(chalk.red(`Error: ${error.message}`));
				process.exit(1);
			}
		});

	// complexity-report command
	programInstance
		.command('complexity-report')
		.description(`Display the complexity analysis report${chalk.reset('')}`)
		.option(
			'-f, --file <file>',
			'Path to the report file',
			'scripts/task-complexity-report.json'
		)
		.action(async (options) => {
			await displayComplexityReport(options.file);
		});

	// add-subtask command
	programInstance
		.command('add-subtask')
		.description(() => JiraClient.isJiraEnabled() 
			? 'Add a new subtask under a Jira issue' 
			: 'Add a subtask to an existing task')
		.option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
		.option(
			'-p, --parent <id>', 
			() => JiraClient.isJiraEnabled()
				? 'Parent Jira issue key (e.g., "PROJ-123")'
				: 'Parent task ID (required)'
		)
		.option(
			'-i, --task-id <id>', 
			() => JiraClient.isJiraEnabled()
				? 'Not applicable for Jira issues'
				: 'Existing task ID to convert to subtask'
		)
		.option(
			'-t, --title <title>',
			() => JiraClient.isJiraEnabled()
				? 'Title/summary for the Jira subtask (required)'
				: 'Title for the new subtask (when creating a new subtask)'
		)
		.option(
			'-d, --description <text>', 
			'Description for the new subtask'
		)
		.option('--details <text>', 'Implementation details for the new subtask')
		.option(
			'--dependencies <ids>',
			() => JiraClient.isJiraEnabled()
				? 'Not applicable for Jira issues - use add-dependency command'
				: 'Comma-separated list of dependency IDs for the new subtask'
		)
		.option('-s, --status <status>', 'Status for the new subtask', 'pending')
		.option('--skip-generate', 'Skip regenerating task files')
		.option(
			'--test-strategy <testStrategy>',
			'Test strategy for the new subtask'
		)
		.option(
			'--acceptance-criteria <criteria>',
			'Acceptance criteria for the new subtask'
		)
		.option(
			'--priority <priority>',
			() => JiraClient.isJiraEnabled()
				? 'Jira priority (e.g., "Medium", "High")'
				: 'Task priority (high, medium, low)',
			'medium'
		)
		.option(
			'--assignee <assignee>',
			() => JiraClient.isJiraEnabled()
				? 'Jira account ID or email of the assignee'
				: 'Jira assignee (only used when Jira is enabled)'
		)
		.option(
			'--labels <labels>',
			() => JiraClient.isJiraEnabled()
				? 'Comma-separated list of labels to add to the Jira subtask'
				: 'Jira labels (only used when Jira is enabled)'
		)
		.action(async (options) => {
			const isJiraEnabled = JiraClient.isJiraEnabled();
			
			if (isJiraEnabled) {
				// Jira mode
				const parentKey = options.parent;
				const title = options.title;
				
				if (!parentKey) {
					console.error(chalk.red('Error: --parent parameter is required. Please provide a parent Jira issue key.'));
					process.exit(1);
				}
				
				if (!title) {
					console.error(chalk.red('Error: --title parameter is required. Please provide a title for the subtask.'));
					process.exit(1);
				}
				
				try {
					// Import the addJiraSubtaskDirect function
					const { addJiraSubtaskDirect } = await import('../../mcp-server/src/core/direct-functions/add-subtask.js');
					
					// Prepare labels if provided
					let labels = [];
					if (options.labels) {
						labels = options.labels.split(',').map(label => label.trim());
					}
					
					// Prepare args for Jira subtask creation
					const args = {
						parentKey,
						title,
						description: options.description || '',
						details: options.details || '',
						testStrategy: options.testStrategy || '',
						acceptanceCriteria: options.acceptanceCriteria || '',
						priority: options.priority || 'medium',
						assignee: options.assignee || null,
						labels
					};
					
					console.log(chalk.blue(`Creating Jira subtask for parent issue ${parentKey}`));
					console.log(chalk.blue(`Title: "${title}"`));
					
					// Call the Jira implementation
					const result = await addJiraSubtaskDirect(
						args,
						{
							info: (msg) => console.log(chalk.blue(msg)),
							warn: (msg) => console.log(chalk.yellow(msg)),
							error: (msg) => console.error(chalk.red(msg))
						},
						{ session: process.env }
					);
					
					if (!result.success) {
						console.error(chalk.red(`Error adding Jira subtask: ${result.error.message || 'Unknown error'}`));
						
						// Display more detailed troubleshooting info based on common error codes
						if (result.error.code === 400 || result.error.code === '400') {
							console.log(chalk.yellow('\nCommon causes for 400 Bad Request errors:'));
							console.log('  1. The parent issue may not support subtasks (some types don\'t allow subtasks)');
							console.log('  2. Required fields might be missing (title must be valid)');
							console.log('  3. The parent issue might not exist or you don\'t have permission to access it');
							console.log('  4. The Jira project might have custom required fields not provided');
							
							console.log(chalk.yellow('\nTry the following:'));
							console.log('  1. Check if you can manually create a subtask for this issue in Jira');
							console.log('  2. Use only basic fields (title and description) without special characters');
							console.log('  3. Verify Jira permissions and project configuration');
						} else {
							// Generic troubleshooting tips
							console.log(chalk.yellow('\nTroubleshooting tips:'));
							console.log('  1. Verify that the parent issue exists and is not a subtask itself');
							console.log('  2. Check that your Jira permissions allow creating subtasks');
							console.log('  3. Validate that all required fields are properly formatted');
							console.log('  4. Try with simpler values for title and description');
						}
						
						if (CONFIG.debug) {
							console.log(chalk.yellow('\nJira API arguments:'));
							console.log(JSON.stringify(args, null, 2));
							
							// If there are detailed error responses, display them
							if (result.error.details) {
								console.log(chalk.yellow('\nDetailed error information:'));
								console.log(JSON.stringify(result.error.details, null, 2));
							}
						}
						
						process.exit(1);
					} else {
						// If successful, display success info
						console.log(chalk.green(`✓ Added new Jira subtask ${result.data.key}`));
						console.log(chalk.gray(`Parent issue: ${parentKey}`));
						
						// Display success message and suggested next steps
						console.log(
							boxen(
								chalk.white.bold(`Subtask ${result.data.key} Added Successfully`) +
									'\n\n' +
									chalk.white(`Title: ${title}`) +
									'\n' +
									chalk.white(`Parent: ${parentKey}`) +
									'\n\n' +
									chalk.white.bold('Next Steps:') +
									'\n' +
									chalk.cyan(
										`1. Run ${chalk.yellow(`task-master show ${result.data.key}`)} to see details of the new subtask`
									) +
									'\n' +
									chalk.cyan(
										`2. Run ${chalk.yellow(`task-master set-status --id=${result.data.key} --status="In Progress"`)} to start working on it`
									),
								{
									padding: 1,
									borderColor: 'green',
									borderStyle: 'round',
									margin: { top: 1 }
								}
							)
						);
					}
				} catch (error) {
					console.error(chalk.red(`Error creating Jira subtask: ${error.message}`));
					if (CONFIG.debug) {
						console.error(error);
					}
					process.exit(1);
				}
			} else {
				// Local mode (original implementation)
				const tasksPath = options.file;
				const parentId = options.parent;
				const existingTaskId = options.taskId;
				const generateFiles = !options.skipGenerate;

				if (!parentId) {
					console.error(
						chalk.red(
							'Error: --parent parameter is required. Please provide a parent task ID.'
						)
					);
					showAddSubtaskHelp();
					process.exit(1);
				}

				// Parse dependencies if provided
				let dependencies = [];
				if (options.dependencies) {
					dependencies = options.dependencies.split(',').map((id) => {
						// Handle both regular IDs and dot notation
						return id.includes('.') ? id.trim() : parseInt(id.trim(), 10);
					});
				}

				try {
					if (existingTaskId) {
						// Convert existing task to subtask
						console.log(
							chalk.blue(
								`Converting task ${existingTaskId} to a subtask of ${parentId}...`
							)
						);
						await addSubtask(
							tasksPath,
							parentId,
							existingTaskId,
							null,
							generateFiles
						);
						console.log(
							chalk.green(
								`✓ Task ${existingTaskId} successfully converted to a subtask of task ${parentId}`
							)
						);
					} else if (options.title) {
						// Create new subtask with provided data
						console.log(
							chalk.blue(`Creating new subtask for parent task ${parentId}...`)
						);

						const newSubtaskData = {
							title: options.title,
							description: options.description || '',
							details: options.details || '',
							status: options.status || 'pending',
							dependencies: dependencies
						};

						const subtask = await addSubtask(
							tasksPath,
							parentId,
							null,
							newSubtaskData,
							generateFiles
						);
						console.log(
							chalk.green(
								`✓ New subtask ${parentId}.${subtask.id} successfully created`
							)
						);

						// Display success message and suggested next steps
						console.log(
							boxen(
								chalk.white.bold(
									`Subtask ${parentId}.${subtask.id} Added Successfully`
								) +
									'\n\n' +
									chalk.white(`Title: ${subtask.title}`) +
									'\n' +
									chalk.white(`Status: ${getStatusWithColor(subtask.status)}`) +
									'\n' +
									(dependencies.length > 0
										? chalk.white(`Dependencies: ${dependencies.join(', ')}`) +
											'\n'
										: '') +
									'\n' +
									chalk.white.bold('Next Steps:') +
									'\n' +
									chalk.cyan(
										`1. Run ${chalk.yellow(`task-master show ${parentId}`)} to see the parent task with all subtasks`
									) +
									'\n' +
									chalk.cyan(
										`2. Run ${chalk.yellow(`task-master set-status --id=${parentId}.${subtask.id} --status=in-progress`)} to start working on it`
									),
								{
									padding: 1,
									borderColor: 'green',
									borderStyle: 'round',
									margin: { top: 1 }
								}
							)
						);
					} else {
						console.error(
							chalk.red('Error: Either --task-id or --title must be provided.')
						);
						console.log(
							boxen(
								chalk.white.bold('Usage Examples:') +
									'\n\n' +
									chalk.white('Convert existing task to subtask:') +
									'\n' +
									chalk.yellow(
										`  task-master add-subtask --parent=5 --task-id=8`
									) +
									'\n\n' +
									chalk.white('Create new subtask:') +
									'\n' +
									chalk.yellow(
										`  task-master add-subtask --parent=5 --title="Implement login UI" --description="Create the login form"`
									) +
									'\n\n',
								{ padding: 1, borderColor: 'blue', borderStyle: 'round' }
							)
						);
						process.exit(1);
					}
				} catch (error) {
					console.error(chalk.red(`Error: ${error.message}`));
					process.exit(1);
				}
			}
		})
		.on('error', function (err) {
			console.error(chalk.red(`Error: ${err.message}`));
			showAddSubtaskHelp();
			process.exit(1);
		});

	// remove-subtask command
	programInstance
		.command('remove-subtask')
		.description(() => JiraClient.isJiraEnabled() 
			? 'Remove a Jira subtask' 
			: 'Remove a subtask from its parent task')
		.option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
		.option(
			'-i, --id <id>',
			() => JiraClient.isJiraEnabled() 
				? 'Jira issue key of the subtask to remove (e.g., "PROJ-456")' 
				: 'Subtask ID(s) to remove in format "parentId.subtaskId" (can be comma-separated for multiple subtasks)'
		)
		.option(
			'-c, --convert',
			() => JiraClient.isJiraEnabled() 
				? 'Convert the subtask to a standalone issue instead of deleting it' 
				: 'Convert the subtask to a standalone task instead of deleting it'
		)
		.option('--skip-generate', 'Skip regenerating task files')
		.action(async (options) => {
			const isJiraEnabled = JiraClient.isJiraEnabled();
			
			if (isJiraEnabled) {
				// Jira mode
				const subtaskKey = options.id;
				const convertToTask = options.convert || false;
				
				if (!subtaskKey) {
					console.error(chalk.red('Error: --id parameter is required. Please provide a subtask issue key.'));
					showRemoveSubtaskHelp();
					process.exit(1);
				}
				
				try {
					// Import the removeJiraSubtaskDirect function
					const { removeJiraSubtaskDirect } = await import('../../mcp-server/src/core/direct-functions/remove-subtask.js');
					
					console.log(chalk.blue(`Removing Jira subtask ${subtaskKey}...`));
					if (convertToTask) {
						console.log(chalk.blue('The subtask will be converted to a standalone issue'));
					}
					
					// Call the Jira implementation
					const result = await removeJiraSubtaskDirect(
						{
							id: subtaskKey,
							convert: convertToTask
						},
						{
							info: (msg) => console.log(chalk.blue(msg)),
							warn: (msg) => console.log(chalk.yellow(msg)),
							error: (msg) => console.error(chalk.red(msg))
						},
						{ session: process.env }
					);
					
					if (!result.success) {
						console.error(chalk.red(`Error: ${result.error.message}`));
						process.exit(1);
					}
					
					if (convertToTask && result.data.convertedKey) {
						// Display success message and next steps for converted task
						console.log(
							boxen(
								chalk.white.bold(`Subtask ${subtaskKey} Converted to Issue ${result.data.convertedKey}`) +
									'\n\n' +
									chalk.white(`Title: ${result.data.title || 'Unknown title'}`) +
									'\n\n' +
									chalk.white.bold('Next Steps:') +
									'\n' +
									chalk.cyan(
										`1. Run ${chalk.yellow(`task-master show ${result.data.convertedKey}`)} to see details of the new issue`
									) +
									'\n' +
									chalk.cyan(
										`2. Run ${chalk.yellow(`task-master set-status --id=${result.data.convertedKey} --status="In Progress"`)} to start working on it`
									),
								{
									padding: 1,
									borderColor: 'green',
									borderStyle: 'round',
									margin: { top: 1 }
								}
							)
						);
					} else {
						// Display success message for deleted subtask
						console.log(
							boxen(
								chalk.white.bold(`Subtask ${subtaskKey} Removed`) +
									'\n\n' +
									chalk.white('The subtask has been successfully deleted.'),
								{
									padding: 1,
									borderColor: 'green',
									borderStyle: 'round',
									margin: { top: 1 }
								}
							)
						);
					}
				} catch (error) {
					console.error(chalk.red(`Error removing Jira subtask: ${error.message}`));
					if (CONFIG.debug) {
						console.error(error);
					}
					process.exit(1);
				}
			} else {
				// Local mode (original implementation)
				const tasksPath = options.file;
				const subtaskIds = options.id;
				const convertToTask = options.convert || false;
				const generateFiles = !options.skipGenerate;

				if (!subtaskIds) {
					console.error(
						chalk.red(
							'Error: --id parameter is required. Please provide subtask ID(s) in format "parentId.subtaskId".'
						)
					);
					showRemoveSubtaskHelp();
					process.exit(1);
				}

				try {
					// Split by comma to support multiple subtask IDs
					const subtaskIdArray = subtaskIds.split(',').map((id) => id.trim());

					for (const subtaskId of subtaskIdArray) {
						// Validate subtask ID format
						if (!subtaskId.includes('.')) {
							console.error(
								chalk.red(
									`Error: Subtask ID "${subtaskId}" must be in format "parentId.subtaskId"`
								)
							);
							showRemoveSubtaskHelp();
							process.exit(1);
						}

						console.log(chalk.blue(`Removing subtask ${subtaskId}...`));
						if (convertToTask) {
							console.log(
								chalk.blue('The subtask will be converted to a standalone task')
							);
						}

						const result = await removeSubtask(
							tasksPath,
							subtaskId,
							convertToTask,
							generateFiles
						);

						if (convertToTask && result) {
							// Display success message and next steps for converted task
							console.log(
								boxen(
									chalk.white.bold(
										`Subtask ${subtaskId} Converted to Task #${result.id}`
									) +
										'\n\n' +
										chalk.white(`Title: ${result.title}`) +
										'\n' +
										chalk.white(`Status: ${getStatusWithColor(result.status)}`) +
										'\n' +
										chalk.white(
											`Dependencies: ${result.dependencies.join(', ')}`
										) +
										'\n\n' +
										chalk.white.bold('Next Steps:') +
										'\n' +
										chalk.cyan(
											`1. Run ${chalk.yellow(`task-master show ${result.id}`)} to see details of the new task`
										) +
										'\n' +
										chalk.cyan(
											`2. Run ${chalk.yellow(`task-master set-status --id=${result.id} --status=in-progress`)} to start working on it`
										),
									{
										padding: 1,
										borderColor: 'green',
										borderStyle: 'round',
										margin: { top: 1 }
									}
								)
							);
						} else {
							// Display success message for deleted subtask
							console.log(
								boxen(
									chalk.white.bold(`Subtask ${subtaskId} Removed`) +
										'\n\n' +
										chalk.white('The subtask has been successfully deleted.'),
									{
										padding: 1,
										borderColor: 'green',
										borderStyle: 'round',
										margin: { top: 1 }
									}
								)
							);
						}
					}
				} catch (error) {
					console.error(chalk.red(`Error: ${error.message}`));
					showRemoveSubtaskHelp();
					process.exit(1);
				}
			}
		})
		.on('error', function (err) {
			console.error(chalk.red(`Error: ${err.message}`));
			showRemoveSubtaskHelp();
			process.exit(1);
		});

	// Helper function to show remove-subtask command help
	function showRemoveSubtaskHelp() {
		const isJiraEnabled = JiraClient.isJiraEnabled();
		
		console.log(
			boxen(
				chalk.white.bold(`Remove ${isJiraEnabled ? 'Jira ' : ''}Subtask Command Help`) +
					'\n\n' +
					chalk.cyan('Usage:') +
					'\n' +
					`  task-master remove-subtask --id=<${isJiraEnabled ? 'key' : 'parentId.subtaskId'}> [options]\n\n` +
					chalk.cyan('Options:') +
					'\n' +
					`  -i, --id <${isJiraEnabled ? 'key' : 'id'}>       ${isJiraEnabled ? 'Jira subtask issue key' : 'Subtask ID(s) to remove in format "parentId.subtaskId" (can be comma-separated)'} (required)\n` +
					`  -c, --convert       Convert the subtask to a standalone ${isJiraEnabled ? 'issue' : 'task'} instead of deleting it\n` +
					(isJiraEnabled ? '' : '  -f, --file <file>   Path to the tasks file (default: "tasks/tasks.json")\n') +
					(isJiraEnabled ? '' : '  --skip-generate     Skip regenerating task files\n') +
					'\n' +
					chalk.cyan('Examples:') +
					'\n' +
					(isJiraEnabled ?
						'  task-master remove-subtask --id=PROJ-456\n' +
						'  task-master remove-subtask --id=PROJ-456 --convert' :
						'  task-master remove-subtask --id=5.2\n' +
						'  task-master remove-subtask --id=5.2,6.3,7.1\n' +
						'  task-master remove-subtask --id=5.2 --convert'),
				{ padding: 1, borderColor: 'blue', borderStyle: 'round' }
			)
		);
	}

	// remove-task command
	programInstance
		.command('remove-task')
		.description(() => JiraClient.isJiraEnabled() 
			? 'Remove a Jira issue from the project' 
			: 'Remove one or more tasks or subtasks permanently')
		.option(
			'-i, --id <id>',
			() => JiraClient.isJiraEnabled() 
				? 'Jira issue key(s) to remove (e.g., "PROJ-123" or "PROJ-123,PROJ-124")' 
				: 'ID(s) of the task(s) or subtask(s) to remove (e.g., "5" or "5.2" or "5,6,7")'
		)
		.option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
		.option('-y, --yes', 'Skip confirmation prompt', false)
		.action(async (options) => {
			const isJiraEnabled = JiraClient.isJiraEnabled();
			
			if (isJiraEnabled) {
				// Jira mode
				const issueKeys = options.id;
				
				if (!issueKeys) {
					console.error(chalk.red('Error: --id parameter is required. Please provide one or more Jira issue keys.'));
					console.error(chalk.yellow('Usage: task-master remove-task --id=PROJ-123'));
					process.exit(1);
				}
				
				try {
					// Import the removeJiraTaskDirect function
					const { removeJiraTaskDirect } = await import('../../mcp-server/src/core/direct-functions/remove-task.js');
					
					// Split by comma to support multiple issue keys
					const issueKeyArray = issueKeys.split(',').map(key => key.trim());
					
					// Skip confirmation if --yes flag is provided
					if (!options.yes) {
						// Display issues to be removed
						console.log();
						console.log(chalk.red.bold('⚠️ WARNING: This will permanently delete the following Jira issues:'));
						console.log();
						
						for (const key of issueKeyArray) {
							console.log(chalk.white.bold(`Issue: ${key}`));
						}
						console.log();
						
						// Prompt for confirmation
						const { confirm } = await inquirer.prompt([
							{
								type: 'confirm',
								name: 'confirm',
								message: chalk.red.bold(
									`Are you sure you want to permanently delete ${issueKeyArray.length > 1 ? 'these issues' : 'this issue'}?`
								),
								default: false
							}
						]);
						
						if (!confirm) {
							console.log(chalk.blue('Issue deletion cancelled.'));
							process.exit(0);
						}
					}
					
					const indicator = startLoadingIndicator('Removing Jira issues...');
					
					// Call the Jira implementation
					const result = await removeJiraTaskDirect(
						{
							id: issueKeys
						},
						{
							info: (msg) => console.log(chalk.blue(msg)),
							warn: (msg) => console.log(chalk.yellow(msg)),
							error: (msg) => console.error(chalk.red(msg))
						},
						{ session: process.env }
					);
					
					stopLoadingIndicator(indicator);
					
					if (result.success) {
						const results = result.data.results || [];
						const successfulRemovals = results.filter(r => r.success);
						const failedRemovals = results.filter(r => !r.success);
						
						if (successfulRemovals.length > 0) {
							console.log(
								boxen(
									chalk.green(
										`Successfully removed ${successfulRemovals.length} issue${successfulRemovals.length > 1 ? 's' : ''}`
									) +
										'\n\n' +
										successfulRemovals
											.map(r => chalk.white(`✓ ${r.key}`))
											.join('\n'),
									{
										padding: 1,
										borderColor: 'green',
										borderStyle: 'round',
										margin: { top: 1 }
									}
								)
							);
						}
						
						if (failedRemovals.length > 0) {
							console.log(
								boxen(
									chalk.red(
										`Failed to remove ${failedRemovals.length} issue${failedRemovals.length > 1 ? 's' : ''}`
									) +
										'\n\n' +
										failedRemovals
											.map(r => chalk.white(`✗ ${r.key}: ${r.error}`))
											.join('\n'),
									{
										padding: 1,
										borderColor: 'red',
										borderStyle: 'round',
										margin: { top: 1 }
									}
								)
							);
							
							// Exit with error if any removals failed
							if (successfulRemovals.length === 0) {
								process.exit(1);
							}
						}
					} else {
						console.error(chalk.red(`Error: ${result.error.message}`));
						process.exit(1);
					}
				} catch (error) {
					console.error(chalk.red(`Error removing Jira issues: ${error.message}`));
					if (CONFIG.debug) {
						console.error(error);
					}
					process.exit(1);
				}
			} else {
				// Local mode (original implementation)
				const tasksPath = options.file;
				const taskIds = options.id;

				if (!taskIds) {
					console.error(chalk.red('Error: Task ID is required'));
					console.error(
						chalk.yellow('Usage: task-master remove-task --id=<taskId>')
					);
					process.exit(1);
				}

				try {
					// Check if the tasks file exists and is valid
					const data = readJSON(tasksPath);
					if (!data || !data.tasks) {
						console.error(
							chalk.red(`Error: No valid tasks found in ${tasksPath}`)
						);
						process.exit(1);
					}

					// Split task IDs if comma-separated
					const taskIdArray = taskIds.split(',').map((id) => id.trim());

					// Validate all task IDs exist before proceeding
					const invalidTasks = taskIdArray.filter(
						(id) => !taskExists(data.tasks, id)
					);
					if (invalidTasks.length > 0) {
						console.error(
							chalk.red(
								`Error: The following tasks were not found: ${invalidTasks.join(', ')}`
							)
						);
						process.exit(1);
					}

					// Skip confirmation if --yes flag is provided
					if (!options.yes) {
						// Display tasks to be removed
						console.log();
						console.log(
							chalk.red.bold(
								'⚠️ WARNING: This will permanently delete the following tasks:'
							)
						);
						console.log();

						for (const taskId of taskIdArray) {
							const task = findTaskById(data.tasks, taskId);

							if (typeof taskId === 'string' && taskId.includes('.')) {
								// It's a subtask
								const [parentId, subtaskId] = taskId.split('.');
								console.log(chalk.white.bold(`Subtask ${taskId}: ${task.title}`));
								console.log(
									chalk.gray(
										`Parent Task: ${task.parentTask.id} - ${task.parentTask.title}`
									)
								);
							} else {
								// It's a main task
								console.log(chalk.white.bold(`Task ${taskId}: ${task.title}`));

								// Show if it has subtasks
								if (task.subtasks && task.subtasks.length > 0) {
									console.log(
										chalk.yellow(
											`⚠️ This task has ${task.subtasks.length} subtasks that will also be deleted!`
										)
									);
								}

								// Show if other tasks depend on it
								const dependentTasks = data.tasks.filter(
									(t) =>
										t.dependencies &&
										t.dependencies.includes(parseInt(taskId, 10))
								);

								if (dependentTasks.length > 0) {
									console.log(
										chalk.yellow(
											`⚠️ Warning: ${dependentTasks.length} other tasks depend on this task!`
										)
									);
									console.log(
										chalk.yellow('These dependencies will be removed:')
									);
									dependentTasks.forEach((t) => {
										console.log(chalk.yellow(`  - Task ${t.id}: ${t.title}`));
									});
								}
							}
							console.log();
						}

						// Prompt for confirmation
						const { confirm } = await inquirer.prompt([
							{
								type: 'confirm',
								name: 'confirm',
								message: chalk.red.bold(
									`Are you sure you want to permanently delete ${taskIdArray.length > 1 ? 'these tasks' : 'this task'}?`
								),
								default: false
							}
						]);

						if (!confirm) {
							console.log(chalk.blue('Task deletion cancelled.'));
							process.exit(0);
						}
					}

					const indicator = startLoadingIndicator('Removing tasks...');

					// Remove each task
					const results = [];
					for (const taskId of taskIdArray) {
						try {
							const result = await removeTask(tasksPath, taskId);
							results.push({ taskId, success: true, ...result });
						} catch (error) {
							results.push({ taskId, success: false, error: error.message });
						}
					}

					stopLoadingIndicator(indicator);

					// Display results
					const successfulRemovals = results.filter((r) => r.success);
					const failedRemovals = results.filter((r) => !r.success);

					if (successfulRemovals.length > 0) {
						console.log(
							boxen(
								chalk.green(
									`Successfully removed ${successfulRemovals.length} task${successfulRemovals.length > 1 ? 's' : ''}`
								) +
									'\n\n' +
									successfulRemovals
										.map((r) =>
											chalk.white(
												`✓ ${r.taskId.includes('.') ? 'Subtask' : 'Task'} ${r.taskId}`
											)
										)
										.join('\n'),
								{
									padding: 1,
									borderColor: 'green',
									borderStyle: 'round',
									margin: { top: 1 }
								}
							)
						);
					}

					if (failedRemovals.length > 0) {
						console.log(
							boxen(
								chalk.red(
									`Failed to remove ${failedRemovals.length} task${failedRemovals.length > 1 ? 's' : ''}`
								) +
									'\n\n' +
									failedRemovals
										.map((r) => chalk.white(`✗ ${r.taskId}: ${r.error}`))
										.join('\n'),
								{
									padding: 1,
									borderColor: 'red',
									borderStyle: 'round',
									margin: { top: 1 }
								}
							)
						);

						// Exit with error if any removals failed
						if (successfulRemovals.length === 0) {
							process.exit(1);
						}
					}
				} catch (error) {
					console.error(
						chalk.red(`Error: ${error.message || 'An unknown error occurred'}`)
					);
					process.exit(1);
				}
			}
		});

	// init command (Directly calls the implementation from init.js)
	programInstance
		.command('init')
		.description('Initialize a new project with Task Master structure')
		.option('-y, --yes', 'Skip prompts and use default values')
		.option('-n, --name <name>', 'Project name')
		.option('-d, --description <description>', 'Project description')
		.option('-v, --version <version>', 'Project version', '0.1.0') // Set default here
		.option('-a, --author <author>', 'Author name')
		.option('--skip-install', 'Skip installing dependencies')
		.option('--dry-run', 'Show what would be done without making changes')
		.option('--aliases', 'Add shell aliases (tm, taskmaster)')
		.action(async (cmdOptions) => {
			// cmdOptions contains parsed arguments
			try {
				console.log('DEBUG: Running init command action in commands.js');
				console.log(
					'DEBUG: Options received by action:',
					JSON.stringify(cmdOptions)
				);
				// Directly call the initializeProject function, passing the parsed options
				await initializeProject(cmdOptions);
				// initializeProject handles its own flow, including potential process.exit()
			} catch (error) {
				console.error(
					chalk.red(`Error during initialization: ${error.message}`)
				);
				process.exit(1);
			}
		});

	// Add more commands as needed...

	return programInstance;
}

/**
 * Setup the CLI application
 * @returns {Object} Configured Commander program
 */
function setupCLI() {
	// Create a new program instance
	const programInstance = program
		.name('dev')
		.description('AI-driven development task management')
		.version(() => {
			// Read version directly from package.json
			try {
				const packageJsonPath = path.join(process.cwd(), 'package.json');
				if (fs.existsSync(packageJsonPath)) {
					const packageJson = JSON.parse(
						fs.readFileSync(packageJsonPath, 'utf8')
					);
					return packageJson.version;
				}
			} catch (error) {
				// Silently fall back to default version
			}
			return CONFIG.projectVersion; // Default fallback
		})
		.helpOption('-h, --help', 'Display help')
		.addHelpCommand(false) // Disable default help command
		.on('--help', () => {
			displayHelp(); // Use your custom help display instead
		})
		.on('-h', () => {
			displayHelp();
			process.exit(0);
		});

	// Modify the help option to use your custom display
	programInstance.helpInformation = () => {
		displayHelp();
		return '';
	};

	// Register commands
	registerCommands(programInstance);

	return programInstance;
}

/**
 * Check for newer version of task-master-ai
 * @returns {Promise<{currentVersion: string, latestVersion: string, needsUpdate: boolean}>}
 */
async function checkForUpdate() {
	// Get current version from package.json
	let currentVersion = CONFIG.projectVersion;
	try {
		// Try to get the version from the installed package
		const packageJsonPath = path.join(
			process.cwd(),
			'node_modules',
			'task-master-ai',
			'package.json'
		);
		if (fs.existsSync(packageJsonPath)) {
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
			currentVersion = packageJson.version;
		}
	} catch (error) {
		// Silently fail and use default
		log('debug', `Error reading current package version: ${error.message}`);
	}

	return new Promise((resolve) => {
		// Get the latest version from npm registry
		const options = {
			hostname: 'registry.npmjs.org',
			path: '/task-master-ai',
			method: 'GET',
			headers: {
				Accept: 'application/vnd.npm.install-v1+json' // Lightweight response
			}
		};

		const req = https.request(options, (res) => {
			let data = '';

			res.on('data', (chunk) => {
				data += chunk;
			});

			res.on('end', () => {
				try {
					const npmData = JSON.parse(data);
					const latestVersion = npmData['dist-tags']?.latest || currentVersion;

					// Compare versions
					const needsUpdate =
						compareVersions(currentVersion, latestVersion) < 0;

					resolve({
						currentVersion,
						latestVersion,
						needsUpdate
					});
				} catch (error) {
					log('debug', `Error parsing npm response: ${error.message}`);
					resolve({
						currentVersion,
						latestVersion: currentVersion,
						needsUpdate: false
					});
				}
			});
		});

		req.on('error', (error) => {
			log('debug', `Error checking for updates: ${error.message}`);
			resolve({
				currentVersion,
				latestVersion: currentVersion,
				needsUpdate: false
			});
		});

		// Set a timeout to avoid hanging if npm is slow
		req.setTimeout(3000, () => {
			req.abort();
			log('debug', 'Update check timed out');
			resolve({
				currentVersion,
				latestVersion: currentVersion,
				needsUpdate: false
			});
		});

		req.end();
	});
}

/**
 * Compare semantic versions
 * @param {string} v1 - First version
 * @param {string} v2 - Second version
 * @returns {number} -1 if v1 < v2, 0 if v1 = v2, 1 if v1 > v2
 */
function compareVersions(v1, v2) {
	const v1Parts = v1.split('.').map((p) => parseInt(p, 10));
	const v2Parts = v2.split('.').map((p) => parseInt(p, 10));

	for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
		const v1Part = v1Parts[i] || 0;
		const v2Part = v2Parts[i] || 0;

		if (v1Part < v2Part) return -1;
		if (v1Part > v2Part) return 1;
	}

	return 0;
}

/**
 * Display upgrade notification message
 * @param {string} currentVersion - Current version
 * @param {string} latestVersion - Latest version
 */
function displayUpgradeNotification(currentVersion, latestVersion) {
	const message = boxen(
		`${chalk.blue.bold('Update Available!')} ${chalk.dim(currentVersion)} → ${chalk.green(latestVersion)}\n\n` +
			`Run ${chalk.cyan('npm i task-master-ai@latest -g')} to update to the latest version with new features and bug fixes.`,
		{
			padding: 1,
			margin: { top: 1, bottom: 1 },
			borderColor: 'yellow',
			borderStyle: 'round'
		}
	);

	console.log(message);
}

/**
 * Parse arguments and run the CLI
 * @param {Array} argv - Command-line arguments
 */
async function runCLI(argv = process.argv) {
	try {
		// Display banner if not in a pipe
		if (process.stdout.isTTY) {
			displayBanner();
		}

		// If no arguments provided, show help
		if (argv.length <= 2) {
			displayHelp();
			process.exit(0);
		}

		// Start the update check in the background - don't await yet
		const updateCheckPromise = checkForUpdate();

		// Setup and parse
		const programInstance = setupCLI();
		await programInstance.parseAsync(argv);

		// After command execution, check if an update is available
		const updateInfo = await updateCheckPromise;
		if (updateInfo.needsUpdate) {
			displayUpgradeNotification(
				updateInfo.currentVersion,
				updateInfo.latestVersion
			);
		}
	} catch (error) {
		console.error(chalk.red(`Error: ${error.message}`));

		if (CONFIG.debug) {
			console.error(error);
		}

		process.exit(1);
	}
}

export {
	registerCommands,
	setupCLI,
	runCLI,
	checkForUpdate,
	compareVersions,
	displayUpgradeNotification
};
