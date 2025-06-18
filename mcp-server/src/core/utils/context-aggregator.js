/**
 * Context Aggregator for combining Jira relationship data with Bitbucket PR information
 * Provides intelligent filtering and formatting for optimal LLM consumption
 */

export class ContextAggregator {
  constructor(jiraResolver, bitbucketClient, prMatcher) {
    this.jiraResolver = jiraResolver;
    this.bitbucketClient = bitbucketClient;
    this.prMatcher = prMatcher;
    this.cache = new Map();
    
    // Configuration defaults
    this.config = {
      maxRelated: parseInt(process.env.CONTEXT_MAX_RELATED) || 20,
      maxAgeMonths: parseInt(process.env.CONTEXT_MAX_AGE_MONTHS) || 6,
      cacheTTL: parseInt(process.env.CONTEXT_CACHE_TTL) || 300, // 5 minutes
      enableFallback: process.env.CONTEXT_ENABLE_FALLBACK !== 'false'
    };
  }

  /**
   * Aggregate comprehensive context for a given issue
   * @param {string} issueKey - The Jira issue key
   * @param {Object} options - Configuration options
   * @returns {Object} Structured context object
   */
  async aggregateContext(issueKey, options = {}) {
    const {
      depth = 2,
      includeTypes = ['parent', 'child', 'epic', 'dependency', 'relates'],
      repoSlug = process.env.BITBUCKET_DEFAULT_REPO,
      maxAge = this.config.maxAgeMonths,
      maxRelated = this.config.maxRelated,
      log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
    } = options;

    // Check cache first
    const cacheKey = this.generateCacheKey(issueKey, repoSlug, options);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Primary flow with full context
      const context = await this.buildFullContext(issueKey, {
        depth,
        includeTypes,
        repoSlug,
        maxAge,
        maxRelated,
        log
      });

      // Cache the result
      this.setCache(cacheKey, context);
      return context;

    } catch (error) {
      if (this.config.enableFallback) {
        // Fallback: Return Jira relationships only
        console.warn(`Bitbucket unavailable, returning Jira context only: ${error.message}`);
        return await this.getJiraOnlyContext(issueKey, { depth, includeTypes, maxAge, maxRelated });
      } else {
        throw error;
      }
    }
  }

  /**
   * Build full context with both Jira and Bitbucket data
   * @param {string} issueKey - The Jira issue key
   * @param {Object} options - Configuration options
   * @returns {Object} Full context object
   */
  async buildFullContext(issueKey, options) {
    const { depth, includeTypes, repoSlug, maxAge, maxRelated, log } = options;

    // 1. Get relationship graph from JiraRelationshipResolver
    const relationships = await this.jiraResolver.resolveRelationships(issueKey, {
      depth,
      includeTypes,
      log // Pass the logger to the relationship resolver
    });

    // Add debug information about the relationship resolution
    const debugInfo = {
      relationshipsExists: !!relationships,
      relationshipsSuccess: relationships?.success,
      relationshipsHasData: !!relationships?.data,
      relationshipsHasRelationships: !!relationships?.data?.relationships,
      relationshipsCount: relationships?.data?.relationships?.length || 0,
      relationshipsError: relationships?.error,
      fullRelationshipsObject: relationships
    };

    if (!relationships || !relationships.success || !relationships.data || !relationships.data.relationships) {
      const failureDebugInfo = {
        ...debugInfo,
        reason: 'No relationships found or relationship resolution failed',
        failurePoint: !relationships ? 'no_relationships' : 
                     !relationships.success ? 'not_success' :
                     !relationships.data ? 'no_data' :
                     !relationships.data.relationships ? 'no_relationships_array' : 'unknown'
      };
      return this.createEmptyContext(issueKey, failureDebugInfo);
    }

    // 2. Batch fetch PRs for all related tickets in parallel
    const ticketKeys = relationships.data.relationships.map(r => r.issueKey);
    const prPromises = ticketKeys.map(key =>
      this.prMatcher.findPRsForTicket(key, { repoSlug })
        .catch(error => {
          console.warn(`Failed to fetch PRs for ${key}: ${error.message}`);
          return []; // Return empty array on failure
        })
    );

    const prResults = await Promise.allSettled(prPromises);

    // 3. Combine relationship data with PR data
    const enrichedTickets = relationships.data.relationships.map((relationship, index) => {
      const prResult = prResults[index];
      const pullRequests = prResult.status === 'fulfilled' ? prResult.value : [];
      
      return {
        ticket: relationship.issue,
        relationship: relationship.relationship,
        direction: relationship.direction,
        depth: relationship.depth,
        pullRequests: pullRequests || []
      };
    });

    // 4. Apply intelligent filtering
    const filteredTickets = this.applyIntelligentFiltering(enrichedTickets, maxAge, maxRelated);

    // 5. Calculate relevance scores
    const scoredTickets = filteredTickets.map(ticket => ({
      ...ticket,
      relevanceScore: this.calculateRelevanceScore(ticket.ticket, ticket.pullRequests, ticket.relationship)
    }));

    // 6. Sort by relevance and limit size
    const finalTickets = this.limitContextSize(scoredTickets, maxRelated);

    // 7. Generate summary and insights
    const summary = this.generateSummary(finalTickets, enrichedTickets.length);
    const contextSummary = this.generateContextSummary(finalTickets, summary);

    return {
      sourceTicket: relationships.sourceIssue || { key: issueKey },
      relatedContext: {
        tickets: finalTickets,
        summary,
        contextSummary
      },
      metadata: {
        ...relationships.metadata,
        contextGeneratedAt: new Date().toISOString(),
        repoSlug,
        filteringApplied: enrichedTickets.length > finalTickets.length
      },
      debugInfo: {
        ...debugInfo,
        enrichedTicketsCount: enrichedTickets.length,
        finalTicketsCount: finalTickets.length,
        relationshipsMetadata: relationships.metadata,
        rawRelationships: relationships.data.relationships
      }
    };
  }

  /**
   * Get Jira-only context as fallback
   * @param {string} issueKey - The Jira issue key
   * @param {Object} options - Configuration options
   * @returns {Object} Jira-only context object
   */
  async getJiraOnlyContext(issueKey, options) {
    const { depth, includeTypes, maxAge, maxRelated } = options;

    try {
      const relationships = await this.jiraResolver.resolveRelationships(issueKey, {
        depth,
        includeTypes
      });

      if (!relationships || !relationships.relationships) {
        return this.createEmptyContext(issueKey);
      }

      // Convert to enriched format without PRs
      const enrichedTickets = relationships.relationships.map(relationship => ({
        ticket: relationship.issue,
        relationship: relationship.relationship,
        direction: relationship.direction,
        depth: relationship.depth,
        pullRequests: [],
        relevanceScore: this.calculateRelevanceScore(relationship.issue, [], relationship.relationship)
      }));

      // Apply basic filtering and limiting
      const filteredTickets = this.filterByRecency(enrichedTickets, maxAge);
      const finalTickets = this.limitContextSize(filteredTickets, maxRelated);

      const summary = this.generateSummary(finalTickets, enrichedTickets.length);
      const contextSummary = this.generateContextSummary(finalTickets, summary);

      return {
        sourceTicket: relationships.sourceIssue || { key: issueKey },
        relatedContext: {
          tickets: finalTickets,
          summary,
          contextSummary
        },
        metadata: {
          ...relationships.metadata,
          contextGeneratedAt: new Date().toISOString(),
          fallbackMode: true,
          filteringApplied: enrichedTickets.length > finalTickets.length
        }
      };
    } catch (error) {
      console.error(`Failed to get Jira-only context for ${issueKey}: ${error.message}`);
      return this.createEmptyContext(issueKey);
    }
  }

  /**
   * Apply intelligent filtering based on recency and relevance
   * @param {Array} tickets - Array of enriched ticket objects
   * @param {number} maxAge - Maximum age in months
   * @param {number} maxRelated - Maximum number of related items
   * @returns {Array} Filtered tickets
   */
  applyIntelligentFiltering(tickets, maxAge, maxRelated) {
    // First filter by recency
    const recentTickets = this.filterByRecency(tickets, maxAge);
    
    // Then apply additional relevance-based filtering if needed
    if (recentTickets.length <= maxRelated) {
      return recentTickets;
    }

    // If we still have too many, prioritize by relationship type and status
    return this.prioritizeByImportance(recentTickets, maxRelated);
  }

  /**
   * Filter tickets by recency
   * @param {Array} tickets - Array of ticket objects
   * @param {number} maxAgeMonths - Maximum age in months
   * @returns {Array} Filtered tickets
   */
  filterByRecency(tickets, maxAgeMonths = 6) {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - maxAgeMonths);

    return tickets.filter(ticketData => {
      const ticket = ticketData.ticket;
      const pullRequests = ticketData.pullRequests || [];

      // Check ticket dates
      const ticketDate = this.getTicketDate(ticket);
      if (ticketDate && ticketDate > cutoffDate) {
        return true;
      }

      // Check PR dates
      const hasRecentPR = pullRequests.some(pr => {
        const prDate = this.getPRDate(pr);
        return prDate && prDate > cutoffDate;
      });

      return hasRecentPR;
    });
  }

  /**
   * Prioritize tickets by importance when we need to limit the count
   * @param {Array} tickets - Array of ticket objects
   * @param {number} maxCount - Maximum number to keep
   * @returns {Array} Prioritized tickets
   */
  prioritizeByImportance(tickets, maxCount) {
    // Priority order: parent > child > epic > dependency > relates
    const relationshipPriority = {
      'parent': 100,
      'child': 90,
      'epic': 80,
      'dependency': 70,
      'relates': 60,
      'blocks': 65,
      'blocked': 65
    };

    // Status priority: In Progress > Done > To Do > others
    const statusPriority = {
      'In Progress': 100,
      'Done': 90,
      'To Do': 80,
      'Review': 85,
      'Testing': 85
    };

    const scored = tickets.map(ticketData => {
      const relScore = relationshipPriority[ticketData.relationship] || 50;
      const statusScore = statusPriority[ticketData.ticket.status] || 50;
      const prScore = ticketData.pullRequests.length > 0 ? 20 : 0;
      
      return {
        ...ticketData,
        priorityScore: relScore + statusScore + prScore
      };
    });

    return scored
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, maxCount);
  }

  /**
   * Calculate relevance score for a ticket
   * @param {Object} ticket - The ticket object
   * @param {Array} pullRequests - Associated pull requests
   * @param {string} relationship - Relationship type
   * @returns {number} Relevance score (0-100)
   */
  calculateRelevanceScore(ticket, pullRequests = [], relationship = 'relates') {
    let score = 0;

    // Relationship proximity scoring
    const relationshipScores = {
      'parent': 100,
      'child': 90,
      'epic': 80,
      'dependency': 75,
      'relates': 60,
      'blocks': 70,
      'blocked': 70
    };
    score += relationshipScores[relationship] || 50;

    // Ticket status scoring
    const statusScores = {
      'Done': 90,
      'In Progress': 100,
      'Review': 85,
      'Testing': 85,
      'To Do': 70
    };
    score += (statusScores[ticket.status] || 50) * 0.3;

    // PR status and activity scoring
    if (pullRequests && pullRequests.length > 0) {
      const prScore = pullRequests.reduce((acc, pr) => {
        let prPoints = 0;
        
        // PR status
        if (pr.status === 'MERGED') prPoints += 30;
        else if (pr.status === 'OPEN') prPoints += 20;
        else if (pr.status === 'DECLINED') prPoints += 5;

        // File changes (more changes = more relevant)
        if (pr.fileChangeSummary) {
          const totalFiles = (pr.fileChangeSummary.added || 0) + 
                           (pr.fileChangeSummary.modified || 0) + 
                           (pr.fileChangeSummary.deleted || 0);
          prPoints += Math.min(totalFiles * 2, 20);
        }

        // Recency bonus
        const prDate = this.getPRDate(pr);
        if (prDate) {
          const daysSince = (Date.now() - prDate.getTime()) / (1000 * 60 * 60 * 24);
          if (daysSince < 30) prPoints += 15;
          else if (daysSince < 90) prPoints += 10;
          else if (daysSince < 180) prPoints += 5;
        }

        return acc + prPoints;
      }, 0);

      score += Math.min(prScore * 0.4, 40); // Cap PR contribution
    }

    return Math.min(Math.round(score), 100);
  }

  /**
   * Limit context size while preserving essential relationships
   * @param {Array} tickets - Array of scored ticket objects
   * @param {number} maxRelated - Maximum number of related items
   * @returns {Array} Limited ticket array
   */
  limitContextSize(tickets, maxRelated = 20) {
    if (tickets.length <= maxRelated) {
      return tickets.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
    }

    // Ensure essential relationships (parent/child) are preserved
    const essential = tickets.filter(t => 
      ['parent', 'child'].includes(t.relationship)
    );
    
    const nonEssential = tickets.filter(t => 
      !['parent', 'child'].includes(t.relationship)
    );

    // Sort by relevance score
    const sortedNonEssential = nonEssential.sort((a, b) => 
      (b.relevanceScore || 0) - (a.relevanceScore || 0)
    );

    // Take essential + top non-essential up to maxRelated
    const remainingSlots = maxRelated - essential.length;
    const selected = essential.concat(
      sortedNonEssential.slice(0, Math.max(0, remainingSlots))
    );

    return selected.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  }

  /**
   * Generate summary statistics
   * @param {Array} finalTickets - Final filtered tickets
   * @param {number} originalCount - Original ticket count before filtering
   * @returns {Object} Summary object
   */
  generateSummary(finalTickets, originalCount) {
    const totalPRs = finalTickets.reduce((acc, t) => acc + (t.pullRequests?.length || 0), 0);
    const mergedPRs = finalTickets.reduce((acc, t) => {
      return acc + (t.pullRequests?.filter(pr => pr.status === 'MERGED')?.length || 0);
    }, 0);

    const statusCounts = finalTickets.reduce((acc, t) => {
      const status = t.ticket.status || 'Unknown';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    const avgRelevance = finalTickets.length > 0 
      ? Math.round(finalTickets.reduce((acc, t) => acc + (t.relevanceScore || 0), 0) / finalTickets.length)
      : 0;

    return {
      totalRelated: finalTickets.length,
      filteredOut: originalCount - finalTickets.length,
      completedWork: statusCounts['Done'] || 0,
      activeWork: (statusCounts['In Progress'] || 0) + (statusCounts['Review'] || 0) + (statusCounts['Testing'] || 0),
      totalPRs,
      mergedPRs,
      averageRelevance: avgRelevance,
      statusBreakdown: statusCounts
    };
  }

  /**
   * Generate actionable context summary
   * @param {Array} tickets - Final ticket array
   * @param {Object} summary - Summary statistics
   * @returns {Object} Context summary with insights
   */
  generateContextSummary(tickets, summary) {
    const insights = [];
    
    // Recent activity insights
    if (summary.activeWork > 0) {
      insights.push(`${summary.activeWork} related tickets currently in active development`);
    }
    
    // Implementation history insights
    if (summary.completedWork > 0 && summary.mergedPRs > 0) {
      insights.push(`${summary.completedWork} completed tickets with ${summary.mergedPRs} merged PRs provide implementation context`);
    }
    
    // Technology patterns from PRs
    const technologies = this.extractTechnologyPatterns(tickets);
    if (technologies.length > 0) {
      insights.push(`Common technologies used: ${technologies.slice(0, 3).join(', ')}`);
    }
    
    // Dependency insights
    const dependencies = tickets.filter(t => t.relationship === 'dependency');
    if (dependencies.length > 0) {
      insights.push(`${dependencies.length} dependency relationships require coordination`);
    }

    return {
      overview: `Found ${summary.totalRelated} related tickets with ${summary.totalPRs} associated PRs`,
      recentActivity: summary.activeWork > 0 
        ? `${summary.activeWork} tickets currently in progress`
        : 'No active work found in related tickets',
      completedWork: summary.completedWork > 0
        ? `${summary.completedWork} tickets completed with implementation details`
        : 'No completed work found for reference',
      implementationInsights: insights
    };
  }

  /**
   * Extract technology patterns from PR file changes
   * @param {Array} tickets - Array of ticket objects with PRs
   * @returns {Array} Array of technology names
   */
  extractTechnologyPatterns(tickets) {
    const fileExtensions = new Map();
    
    tickets.forEach(ticket => {
      if (ticket.pullRequests) {
        ticket.pullRequests.forEach(pr => {
          if (pr.files) {
            pr.files.forEach(file => {
              const ext = file.filename?.split('.').pop()?.toLowerCase();
              if (ext) {
                fileExtensions.set(ext, (fileExtensions.get(ext) || 0) + 1);
              }
            });
          }
        });
      }
    });

    // Map extensions to technologies
    const techMap = {
      'js': 'JavaScript',
      'ts': 'TypeScript',
      'jsx': 'React',
      'tsx': 'React/TypeScript',
      'vue': 'Vue.js',
      'py': 'Python',
      'java': 'Java',
      'cs': 'C#',
      'go': 'Go',
      'rs': 'Rust',
      'php': 'PHP',
      'rb': 'Ruby',
      'css': 'CSS',
      'scss': 'SCSS',
      'less': 'LESS',
      'sql': 'SQL',
      'json': 'JSON',
      'yml': 'YAML',
      'yaml': 'YAML',
      'md': 'Markdown'
    };

    return Array.from(fileExtensions.entries())
      .sort((a, b) => b[1] - a[1]) // Sort by frequency
      .map(([ext, count]) => techMap[ext])
      .filter(Boolean)
      .slice(0, 5); // Top 5 technologies
  }

  /**
   * Get the most relevant date from a ticket
   * @param {Object} ticket - The ticket object
   * @returns {Date|null} The ticket date
   */
  getTicketDate(ticket) {
    // Try updated date first, then created date
    const dateStr = ticket.updated || ticket.created || ticket.createdDate || ticket.updatedDate;
    return dateStr ? new Date(dateStr) : null;
  }

  /**
   * Get the most relevant date from a PR
   * @param {Object} pr - The PR object
   * @returns {Date|null} The PR date
   */
  getPRDate(pr) {
    // Try merged date first, then updated, then created
    const dateStr = pr.mergedDate || pr.updatedDate || pr.createdDate || pr.updated || pr.created;
    return dateStr ? new Date(dateStr) : null;
  }

  /**
   * Create empty context object
   * @param {string} issueKey - The issue key
   * @param {Object} debugInfo - Optional debug information
   * @returns {Object} Empty context object
   */
  createEmptyContext(issueKey, debugInfo = null) {
    const result = {
      sourceTicket: { key: issueKey },
      relatedContext: {
        tickets: [],
        summary: {
          totalRelated: 0,
          filteredOut: 0,
          completedWork: 0,
          activeWork: 0,
          totalPRs: 0,
          mergedPRs: 0,
          averageRelevance: 0,
          statusBreakdown: {}
        },
        contextSummary: {
          overview: 'No related tickets found',
          recentActivity: 'No active work found',
          completedWork: 'No completed work found',
          implementationInsights: []
        }
      },
      metadata: {
        contextGeneratedAt: new Date().toISOString(),
        totalRelated: 0,
        maxDepthReached: 0,
        relationshipTypes: []
      }
    };

    if (debugInfo) {
      result.debugInfo = debugInfo;
    }

    return result;
  }

  // Cache Management Methods

  /**
   * Generate cache key for context data
   * @param {string} issueKey - The issue key
   * @param {string} repoSlug - Repository slug
   * @param {Object} options - Options object
   * @returns {string} Cache key
   */
  generateCacheKey(issueKey, repoSlug, options) {
    const optionsStr = JSON.stringify({
      depth: options.depth || 2,
      includeTypes: options.includeTypes || ['parent', 'child', 'epic', 'dependency', 'relates'],
      maxAge: options.maxAge || this.config.maxAgeMonths,
      maxRelated: options.maxRelated || this.config.maxRelated
    });
    return `context:${issueKey}:${repoSlug || 'default'}:${Buffer.from(optionsStr).toString('base64')}`;
  }

  /**
   * Get data from cache
   * @param {string} key - Cache key
   * @returns {Object|null} Cached data or null
   */
  getFromCache(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    // Check TTL
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Set data in cache
   * @param {string} key - Cache key
   * @param {Object} data - Data to cache
   */
  setCache(key, data) {
    // Determine TTL based on data freshness
    const hasActiveWork = data.relatedContext?.summary?.activeWork > 0;
    const ttl = hasActiveWork ? this.config.cacheTTL : this.config.cacheTTL * 6; // 30 min for completed work

    const expiry = Date.now() + (ttl * 1000);
    this.cache.set(key, { data, expiry });

    // Clean up old entries if cache gets too large
    if (this.cache.size > 100) {
      this.cleanupCache();
    }
  }

  /**
   * Clean up expired cache entries
   */
  cleanupCache() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cache entries
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getCacheStats() {
    const now = Date.now();
    let expired = 0;
    let valid = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        expired++;
      } else {
        valid++;
      }
    }

    return {
      total: this.cache.size,
      valid,
      expired,
      hitRate: this.cacheHits / Math.max(this.cacheRequests, 1)
    };
  }

  /**
   * Create standardized error response
   * @param {string} code - Error code
   * @param {string} message - Error message
   * @param {Object} details - Additional error details
   * @returns {Object} Error response object
   */
  createErrorResponse(code, message, details = null) {
    return {
      success: false,
      error: { code, message, details }
    };
  }
}

export default ContextAggregator;