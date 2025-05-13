/**
 * Direct function wrapper for validateDependenciesCommand
 */

import { validateDependenciesCommand } from '../../../../scripts/modules/dependency-manager.js';
import {
	enableSilentMode,
	disableSilentMode
} from '../../../../scripts/modules/utils.js';
import fs from 'fs';
import { JiraClient } from '../utils/jira-client.js';

/**
 * Validate dependencies in tasks.json
 * @param {Object} args - Function arguments
 * @param {string} args.tasksJsonPath - Explicit path to the tasks.json file.
 * @param {Object} log - Logger object
 * @returns {Promise<{success: boolean, data?: Object, error?: {code: string, message: string}}>}
 */
export async function validateDependenciesDirect(args, log) {
	// Destructure the explicit tasksJsonPath
	const { tasksJsonPath } = args;

	if (!tasksJsonPath) {
		log.error('validateDependenciesDirect called without tasksJsonPath');
		return {
			success: false,
			error: {
				code: 'MISSING_ARGUMENT',
				message: 'tasksJsonPath is required'
			}
		};
	}

	try {
		log.info(`Validating dependencies in tasks: ${tasksJsonPath}`);

		// Use the provided tasksJsonPath
		const tasksPath = tasksJsonPath;

		// Verify the file exists
		if (!fs.existsSync(tasksPath)) {
			return {
				success: false,
				error: {
					code: 'FILE_NOT_FOUND',
					message: `Tasks file not found at ${tasksPath}`
				}
			};
		}

		// Enable silent mode to prevent console logs from interfering with JSON response
		enableSilentMode();

		// Call the original command function using the provided tasksPath
		await validateDependenciesCommand(tasksPath);

		// Restore normal logging
		disableSilentMode();

		return {
			success: true,
			data: {
				message: 'Dependencies validated successfully',
				tasksPath
			}
		};
	} catch (error) {
		// Make sure to restore normal logging even if there's an error
		disableSilentMode();

		log.error(`Error validating dependencies: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'VALIDATION_ERROR',
				message: error.message
			}
		};
	}
}

/**
 * Validate dependencies in Jira issues
 * @param {Object} args - Function arguments
 * @param {string} [args.parentKey] - Optional parent/epic key to filter tasks
 * @param {Object} log - Logger object
 * @param {Object} context - Execution context
 * @param {Object} context.session - Session information including authentication
 * @returns {Promise<{success: boolean, data?: Object, error?: {code: string, message: string}}>}
 */
export async function validateJiraDependenciesDirect(args, log, context = {}) {
	const { parentKey } = args;
	const { session } = context;
	
	try {
		log.info(`Validating dependencies in Jira issues ${parentKey ? `for parent ${parentKey}` : 'in project'}`);

		// Initialize Jira client
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

		// Enable silent mode to prevent console logs from interfering with JSON response
		enableSilentMode();

		try {
			// Build JQL query based on whether parentKey is provided
			let jql;
			if (parentKey) {
				// If parentKey is provided, get issues for the specific parent
				jql = `project = "${jiraClient.config.project}" AND (parent = "${parentKey}" OR issuekey = "${parentKey}") ORDER BY created ASC`;
				log.info(`Fetching Jira issues for parent ${parentKey} with JQL: ${jql}`);
			} else {
				// If no parentKey, get all issues in the project
				jql = `project = "${jiraClient.config.project}" ORDER BY created ASC`;
				log.info(`Fetching all Jira issues with JQL: ${jql}`);
			}
			
			// Fetch all issues matching the JQL query
			const searchResult = await jiraClient.searchIssues(jql, {
				maxResults: 100,
				expand: true,
				log
			});
			
			if (!searchResult.success) {
				disableSilentMode();
				return searchResult; // Return the error response
			}
			
			const issues = searchResult.data;
			if (issues.length === 0) {
				disableSilentMode();
				return {
					success: false,
					error: {
						code: 'ISSUES_NOT_FOUND',
						message: `No issues found${parentKey ? ` for parent ${parentKey}` : ''}`
					}
				};
			}
			
			// Build a map of issue keys for existence validation
			const issueKeysSet = new Set(issues.map(issue => issue.jiraKey));
			
			// Validate all dependencies
			const invalidDependencies = [];
			
			// Analyze dependencies in each issue
			for (const issue of issues) {
				// Skip if no dependencies
				if (!issue.dependencies || issue.dependencies.length === 0) {
					continue;
				}
				
				// Check each dependency
				for (const dependencyKey of issue.dependencies) {
					// Check for self-dependencies
					if (dependencyKey === issue.jiraKey) {
						invalidDependencies.push({
							type: 'self',
							issueKey: issue.jiraKey,
							message: `Issue ${issue.jiraKey} depends on itself`
						});
						continue;
					}
					
					// Check if dependency exists in Jira
					if (!issueKeysSet.has(dependencyKey)) {
						invalidDependencies.push({
							type: 'missing',
							issueKey: issue.jiraKey,
							dependencyKey: dependencyKey,
							message: `Issue ${issue.jiraKey} depends on non-existent issue ${dependencyKey}`
						});
					}
				}
			}
			
			// Check for circular dependencies
			const dependencyMap = new Map();
			
			// Build the dependency map
			for (const issue of issues) {
				if (issue.dependencies && issue.dependencies.length > 0) {
					dependencyMap.set(issue.jiraKey, issue.dependencies);
				} else {
					dependencyMap.set(issue.jiraKey, []);
				}
			}
			
			// Helper function to detect cycles using DFS
			function detectCycle(issueKey, visited = new Set(), path = new Set()) {
				if (!dependencyMap.has(issueKey)) {
					return false;
				}
				
				visited.add(issueKey);
				path.add(issueKey);
				
				const dependencies = dependencyMap.get(issueKey) || [];
				
				for (const depKey of dependencies) {
					if (!visited.has(depKey)) {
						if (detectCycle(depKey, visited, path)) {
							return true;
						}
					} else if (path.has(depKey)) {
						// Found a cycle
						invalidDependencies.push({
							type: 'circular',
							issueKey: issueKey,
							dependencyKey: depKey,
							message: `Issue ${issueKey} is part of a circular dependency chain involving ${depKey}`
						});
						return true;
					}
				}
				
				path.delete(issueKey);
				return false;
			}
			
			// Check each issue for cycles
			for (const issue of issues) {
				detectCycle(issue.jiraKey, new Set(), new Set());
			}
			
			// Filter out duplicate error messages for circular dependencies
			const uniqueInvalidDependencies = [];
			const seenCycles = new Set();
			
			for (const dependency of invalidDependencies) {
				if (dependency.type === 'circular') {
					const cycleKey = `${dependency.issueKey}-${dependency.dependencyKey}`;
					const reverseCycleKey = `${dependency.dependencyKey}-${dependency.issueKey}`;
					
					if (!seenCycles.has(cycleKey) && !seenCycles.has(reverseCycleKey)) {
						seenCycles.add(cycleKey);
						uniqueInvalidDependencies.push(dependency);
					}
				} else {
					uniqueInvalidDependencies.push(dependency);
				}
			}
			
			// Restore normal logging
			disableSilentMode();
			
			// Prepare result data
			const result = {
				valid: uniqueInvalidDependencies.length === 0,
				issues: uniqueInvalidDependencies,
				stats: {
					totalIssues: issues.length,
					withDependencies: issues.filter(i => i.dependencies && i.dependencies.length > 0).length,
					invalidDependencies: uniqueInvalidDependencies.length
				}
			};
			
			// Log summary
			if (result.valid) {
				log.info(`All dependencies are valid across ${result.stats.totalIssues} Jira issues.`);
			} else {
				log.warn(`Found ${result.issues.length} invalid dependencies across ${result.stats.totalIssues} Jira issues.`);
				
				// Group issues by type for a better summary
				const selfDeps = result.issues.filter(i => i.type === 'self').length;
				const missingDeps = result.issues.filter(i => i.type === 'missing').length;
				const circularDeps = result.issues.filter(i => i.type === 'circular').length;
				
				if (selfDeps > 0) log.warn(`- ${selfDeps} self-dependencies`);
				if (missingDeps > 0) log.warn(`- ${missingDeps} missing dependencies`);
				if (circularDeps > 0) log.warn(`- ${circularDeps} circular dependencies`);
			}
			
			return {
				success: true,
				data: {
					message: result.valid 
						? 'All Jira dependencies valid' 
						: `Found ${result.issues.length} issues with invalid dependencies`,
					valid: result.valid,
					issues: result.issues,
					stats: result.stats
				}
			};
			
		} catch (error) {
			// Handle errors from Jira API
			disableSilentMode();
			
			log.error(`Error validating Jira dependencies: ${error.message}`);
			return {
				success: false,
				error: {
					code: 'JIRA_API_ERROR',
					message: `Error validating Jira dependencies: ${error.message}`,
					details: error.response?.data
				}
			};
		}
	} catch (error) {
		// Make sure to restore normal logging even if there's an error
		disableSilentMode();

		log.error(`Error in validateJiraDependenciesDirect: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'VALIDATION_ERROR',
				message: error.message
			}
		};
	}
}
