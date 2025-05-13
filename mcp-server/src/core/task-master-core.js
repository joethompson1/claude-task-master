/**
 * task-master-core.js
 * Central module that imports and re-exports all direct function implementations
 * for improved organization and maintainability.
 */

// Import direct function implementations
import { listTasksDirect } from './direct-functions/list-tasks.js';
import { getCacheStatsDirect } from './direct-functions/cache-stats.js';
import { parsePRDDirect, parsePRDWithJiraDirect } from './direct-functions/parse-prd.js';
import { updateTasksDirect } from './direct-functions/update-tasks.js';
import { updateTaskByIdDirect } from './direct-functions/update-task-by-id.js';
import { updateSubtaskByIdDirect, updateJiraSubtaskByIdDirect } from './direct-functions/update-subtask-by-id.js';
import { generateTaskFilesDirect } from './direct-functions/generate-task-files.js';
import { setTaskStatusDirect, setJiraTaskStatusDirect } from './direct-functions/set-task-status.js';
import { showTaskDirect, showJiraTaskDirect } from './direct-functions/show-task.js';
import { nextTaskDirect, nextJiraTaskDirect } from './direct-functions/next-task.js';
import { expandTaskDirect, expandJiraTaskDirect } from './direct-functions/expand-task.js';
import { addTaskDirect, addJiraTaskDirect } from './direct-functions/add-task.js';
import { addSubtaskDirect, addJiraSubtaskDirect } from './direct-functions/add-subtask.js';
import { removeSubtaskDirect, removeJiraSubtaskDirect } from './direct-functions/remove-subtask.js';
import { analyzeTaskComplexityDirect, analyzeJiraComplexityDirect } from './direct-functions/analyze-task-complexity.js';
import { clearSubtasksDirect, clearJiraSubtasksDirect } from './direct-functions/clear-subtasks.js';
import { expandAllTasksDirect, expandAllJiraTasksDirect } from './direct-functions/expand-all-tasks.js';
import { removeDependencyDirect, removeJiraDependencyDirect } from './direct-functions/remove-dependency.js';
import { validateDependenciesDirect } from './direct-functions/validate-dependencies.js';
import { fixDependenciesDirect, fixJiraDependenciesDirect } from './direct-functions/fix-dependencies.js';
import { complexityReportDirect } from './direct-functions/complexity-report.js';
import { addDependencyDirect, addJiraDependencyDirect } from './direct-functions/add-dependency.js';
import { removeTaskDirect, removeJiraTaskDirect } from './direct-functions/remove-task.js';
import { initializeProjectDirect } from './direct-functions/initialize-project.js';
import { modelsDirect } from './direct-functions/models.js';

// Re-export utility functions
export { findTasksJsonPath } from './utils/path-utils.js';

// Use Map for potential future enhancements like introspection or dynamic dispatch
export const directFunctions = new Map([
	['listTasksDirect', listTasksDirect],
	['getCacheStatsDirect', getCacheStatsDirect],
	['parsePRDDirect', parsePRDDirect],
	['parsePRDWithJiraDirect', parsePRDWithJiraDirect],
	['updateTasksDirect', updateTasksDirect],
	['updateTaskByIdDirect', updateTaskByIdDirect],
	['updateSubtaskByIdDirect', updateSubtaskByIdDirect],
	['updateJiraSubtaskByIdDirect', updateJiraSubtaskByIdDirect],
	['generateTaskFilesDirect', generateTaskFilesDirect],
	['setTaskStatusDirect', setTaskStatusDirect],
	['setJiraTaskStatusDirect', setJiraTaskStatusDirect],
	['showTaskDirect', showTaskDirect],
	['showJiraTaskDirect', showJiraTaskDirect],
	['nextTaskDirect', nextTaskDirect],
	['nextJiraTaskDirect', nextJiraTaskDirect],
	['expandTaskDirect', expandTaskDirect],
	['expandJiraTaskDirect', expandJiraTaskDirect],
	['addTaskDirect', addTaskDirect],
	['addJiraTaskDirect', addJiraTaskDirect],
	['addSubtaskDirect', addSubtaskDirect],
	['addJiraSubtaskDirect', addJiraSubtaskDirect],
	['removeSubtaskDirect', removeSubtaskDirect],
	['removeJiraSubtaskDirect', removeJiraSubtaskDirect],
	['analyzeTaskComplexityDirect', analyzeTaskComplexityDirect],
	['analyzeJiraComplexityDirect', analyzeJiraComplexityDirect],
	['clearSubtasksDirect', clearSubtasksDirect],
	['clearJiraSubtasksDirect', clearJiraSubtasksDirect],
	['expandAllTasksDirect', expandAllTasksDirect],
	['expandAllJiraTasksDirect', expandAllJiraTasksDirect],
	['removeDependencyDirect', removeDependencyDirect],
	['removeJiraDependencyDirect', removeJiraDependencyDirect],
	['validateDependenciesDirect', validateDependenciesDirect],
	['fixDependenciesDirect', fixDependenciesDirect],
	['fixJiraDependenciesDirect', fixJiraDependenciesDirect],
	['complexityReportDirect', complexityReportDirect],
	['addDependencyDirect', addDependencyDirect],
	['addJiraDependencyDirect', addJiraDependencyDirect],
	['removeTaskDirect', removeTaskDirect],
	['removeJiraTaskDirect', removeJiraTaskDirect],
	['initializeProjectDirect', initializeProjectDirect],
	['modelsDirect', modelsDirect]
]);

// Re-export all direct function implementations
export {
	listTasksDirect,
	getCacheStatsDirect,
	parsePRDDirect,
	parsePRDWithJiraDirect,
	updateTasksDirect,
	updateTaskByIdDirect,
	updateSubtaskByIdDirect,
	updateJiraSubtaskByIdDirect,
	generateTaskFilesDirect,
	setTaskStatusDirect,
	setJiraTaskStatusDirect,
	showTaskDirect,
	showJiraTaskDirect,
	nextTaskDirect,
	nextJiraTaskDirect,
	expandTaskDirect,
	expandJiraTaskDirect,
	addTaskDirect,
	addJiraTaskDirect,
	addSubtaskDirect,
	addJiraSubtaskDirect,
	removeSubtaskDirect,
	removeJiraSubtaskDirect,
	analyzeTaskComplexityDirect,
	analyzeJiraComplexityDirect,
	clearSubtasksDirect,
	clearJiraSubtasksDirect,
	expandAllTasksDirect,
	expandAllJiraTasksDirect,
	removeDependencyDirect,
	removeJiraDependencyDirect,
	validateDependenciesDirect,
	fixDependenciesDirect,
	fixJiraDependenciesDirect,
	complexityReportDirect,
	addDependencyDirect,
	addJiraDependencyDirect,
	removeTaskDirect,
	removeJiraTaskDirect,
	initializeProjectDirect,
	modelsDirect
};