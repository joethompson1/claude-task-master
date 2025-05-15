/**
 * Direct function wrapper for fixDependenciesCommand
 */

import { fixDependenciesCommand } from '../../../../scripts/modules/dependency-manager.js';
import {
	enableSilentMode,
	disableSilentMode
} from '../../../../scripts/modules/utils.js';
import fs from 'fs';
import { JiraClient } from '../utils/jira-client.js';
import { validateJiraDependenciesDirect } from './validate-dependencies.js';

/**
 * Fix invalid dependencies in tasks.json automatically
 * @param {Object} args - Function arguments
 * @param {string} args.tasksJsonPath - Explicit path to the tasks.json file.
 * @param {Object} log - Logger object
 * @returns {Promise<{success: boolean, data?: Object, error?: {code: string, message: string}}>}
 */
export async function fixDependenciesDirect(args, log) {
	// Destructure expected args
	const { tasksJsonPath } = args;
	try {
		log.info(`Fixing invalid dependencies in tasks: ${tasksJsonPath}`);

		// Check if tasksJsonPath was provided
		if (!tasksJsonPath) {
			log.error('fixDependenciesDirect called without tasksJsonPath');
			return {
				success: false,
				error: {
					code: 'MISSING_ARGUMENT',
					message: 'tasksJsonPath is required'
				}
			};
		}

		// Use provided path
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

		// Call the original command function using the provided path
		await fixDependenciesCommand(tasksPath);

		// Restore normal logging
		disableSilentMode();

		return {
			success: true,
			data: {
				message: 'Dependencies fixed successfully',
				tasksPath
			}
		};
	} catch (error) {
		// Make sure to restore normal logging even if there's an error
		disableSilentMode();

		log.error(`Error fixing dependencies: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'FIX_DEPENDENCIES_ERROR',
				message: error.message
			}
		};
	}
}

/**
 * Fix invalid dependencies in Jira issues automatically
 * @param {Object} args - Function arguments
 * @param {string} [args.parentKey] - Optional parent/epic key to filter tasks
 * @param {Object} log - Logger object
 * @param {Object} context - Execution context
 * @param {Object} context.session - Session information including authentication
 * @returns {Promise<{success: boolean, data?: Object, error?: {code: string, message: string}}>}
 */
export async function fixJiraDependenciesDirect(args, log, context = {}) {
	const { parentKey } = args;
	const { session } = context;

	try {
		log.info(
			`Fixing invalid dependencies in Jira issues ${parentKey ? `for parent ${parentKey}` : 'in project'}`
		);

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

		// First, validate dependencies to find issues
		const validationResult = await validateJiraDependenciesDirect(
			args,
			log,
			context
		);

		if (!validationResult.success) {
			return validationResult; // Return the error response
		}

		// If all dependencies are already valid, return early
		if (validationResult.data.valid) {
			return {
				success: true,
				data: {
					message: 'All Jira dependencies are already valid, nothing to fix',
					stats: validationResult.data.stats
				}
			};
		}

		// Begin fixing issues
		log.info(
			`Found ${validationResult.data.issues.length} invalid dependencies to fix`
		);

		// Enable silent mode to prevent console logs from interfering with JSON response
		enableSilentMode();

		// Group issues by type for more targeted fixing
		const selfDeps = validationResult.data.issues.filter(
			(i) => i.type === 'self'
		);
		const missingDeps = validationResult.data.issues.filter(
			(i) => i.type === 'missing'
		);
		const circularDeps = validationResult.data.issues.filter(
			(i) => i.type === 'circular'
		);

		const stats = {
			selfDepsRemoved: 0,
			missingDepsRemoved: 0,
			circularDepsRemoved: 0,
			totalRemoved: 0,
			unfixable: 0
		};

		try {
			const client = jiraClient.getClient();

			// Helper function to get issue links
			async function getIssueLinks(issueKey) {
				try {
					const response = await client.get(`/rest/api/3/issue/${issueKey}`, {
						params: {
							fields: 'issuelinks'
						}
					});

					return response.data?.fields?.issuelinks || [];
				} catch (error) {
					log.error(
						`Error fetching issue links for ${issueKey}: ${error.message}`
					);
					return [];
				}
			}

			// Helper function to remove a specific dependency link
			async function removeDependency(issueKey, dependencyKey) {
				try {
					// Get all issue links
					const issueLinks = await getIssueLinks(issueKey);

					// Find the specific link that represents this dependency
					let linkIdToRemove = null;

					for (const link of issueLinks) {
						if (
							(link.inwardIssue && link.inwardIssue.key === dependencyKey) ||
							(link.outwardIssue && link.outwardIssue.key === dependencyKey)
						) {
							linkIdToRemove = link.id;
							break;
						}
					}

					// If no matching link was found
					if (!linkIdToRemove) {
						log.warn(
							`No dependency link found between issues ${issueKey} and ${dependencyKey}`
						);
						return false;
					}

					// Delete the link
					await client.delete(`/rest/api/3/issueLink/${linkIdToRemove}`);
					log.info(
						`Successfully removed dependency link between ${issueKey} and ${dependencyKey}`
					);
					return true;
				} catch (error) {
					log.error(
						`Error removing dependency between ${issueKey} and ${dependencyKey}: ${error.message}`
					);
					return false;
				}
			}

			// 1. Fix self-dependencies (remove them)
			for (const dep of selfDeps) {
				const success = await removeDependency(dep.issueKey, dep.issueKey);
				if (success) {
					stats.selfDepsRemoved++;
					stats.totalRemoved++;
				} else {
					stats.unfixable++;
				}
			}

			// 2. Fix missing dependencies (remove them)
			for (const dep of missingDeps) {
				const success = await removeDependency(dep.issueKey, dep.dependencyKey);
				if (success) {
					stats.missingDepsRemoved++;
					stats.totalRemoved++;
				} else {
					stats.unfixable++;
				}
			}

			// 3. Fix circular dependencies (remove one link in each cycle)
			// We need to be more careful here to avoid breaking too many links
			const fixedCircles = new Set();

			for (const dep of circularDeps) {
				const cycleKey = `${dep.issueKey}-${dep.dependencyKey}`;
				const reverseCycleKey = `${dep.dependencyKey}-${dep.issueKey}`;

				// Skip if we've already fixed this cycle
				if (fixedCircles.has(cycleKey) || fixedCircles.has(reverseCycleKey)) {
					continue;
				}

				// Remove the dependency link
				const success = await removeDependency(dep.issueKey, dep.dependencyKey);

				if (success) {
					fixedCircles.add(cycleKey);
					stats.circularDepsRemoved++;
					stats.totalRemoved++;
				} else {
					stats.unfixable++;
				}
			}

			// Restore normal logging
			disableSilentMode();

			// Format summary message
			let summaryMessage = `Fixed ${stats.totalRemoved} dependencies`;
			const details = [];

			if (stats.selfDepsRemoved > 0)
				details.push(`${stats.selfDepsRemoved} self-dependencies`);
			if (stats.missingDepsRemoved > 0)
				details.push(`${stats.missingDepsRemoved} missing dependencies`);
			if (stats.circularDepsRemoved > 0)
				details.push(`${stats.circularDepsRemoved} circular dependencies`);

			if (details.length > 0) {
				summaryMessage += ` (${details.join(', ')})`;
			}

			if (stats.unfixable > 0) {
				summaryMessage += `. Unable to fix ${stats.unfixable} dependencies.`;
			}

			// Return success result
			return {
				success: true,
				data: {
					message: summaryMessage,
					stats: {
						...stats,
						originalIssues: validationResult.data.issues.length
					}
				}
			};
		} catch (error) {
			// Handle errors from Jira API
			disableSilentMode();

			log.error(`Error fixing Jira dependencies: ${error.message}`);
			return {
				success: false,
				error: {
					code: 'JIRA_API_ERROR',
					message: `Error fixing Jira dependencies: ${error.message}`,
					details: error.response?.data
				}
			};
		}
	} catch (error) {
		// Make sure to restore normal logging even if there's an error
		disableSilentMode();

		log.error(`Error in fixJiraDependenciesDirect: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'FIX_DEPENDENCIES_ERROR',
				message: error.message
			}
		};
	}
}
