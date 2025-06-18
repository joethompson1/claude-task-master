/**
 * pr-ticket-matcher.js
 *
 * Service to identify relationships between Jira tickets and Bitbucket Pull Requests
 * through various linking mechanisms including commit message parsing, branch naming
 * conventions, and Bitbucket-Jira integration links.
 */

/**
 * Common patterns found in commit messages to identify ticket references
 */
const TICKET_PATTERNS = [
  /([A-Z]{2,}-\d+):\s*/,           // "JAR-123: Fix bug"
  /([A-Z]{2,}-\d+)\s*-\s*/,       // "JAR-123 - Fix bug"
  /\[([A-Z]{2,}-\d+)\]/,          // "[JAR-123] Fix bug"
  /([A-Z]{2,}-\d+)\s*\|\s*/,      // "JAR-123 | Fix bug"
  /\b([A-Z]{2,}-\d+)\b/g,         // "JAR-123" as word boundary (for extraction only)
];

/**
 * Standard branch naming patterns
 */
const BRANCH_PATTERNS = [
  /^feature\/([A-Z]{2,}-\d+)/,    // "feature/JAR-123-description"
  /^bugfix\/([A-Z]{2,}-\d+)/,     // "bugfix/JAR-123-fix"
  /^hotfix\/([A-Z]{2,}-\d+)/,     // "hotfix/JAR-123-urgent"
  /^([A-Z]{2,}-\d+)-/,            // "JAR-123-feature-description"
  /\/([A-Z]{2,}-\d+)-/,           // "any-prefix/JAR-123-description"
];

/**
 * Confidence score thresholds
 */
const CONFIDENCE_THRESHOLDS = {
  OFFICIAL_LINK: 95,    // Official Jira-Bitbucket links
  EXACT_BRANCH: 90,     // Exact branch name match
  COMMIT_TITLE: 85,     // Ticket in commit title
  COMMIT_MESSAGE: 75,   // Ticket in commit message
  BRANCH_PATTERN: 70,   // Standard branch pattern
  PARTIAL_MATCH: 50,    // Partial or weak indicators
  UNCERTAIN: 25         // Very uncertain matches
};

/**
 * PRTicketMatcher class for identifying relationships between Jira tickets and Bitbucket PRs
 */
export class PRTicketMatcher {
  /**
   * Create a new PRTicketMatcher instance
   * @param {Object} bitbucketClient - BitbucketClient instance
   * @param {Object} jiraClient - JiraClient instance
   */
  constructor(bitbucketClient, jiraClient) {
    this.bitbucketClient = bitbucketClient;
    this.jiraClient = jiraClient;
    this.cache = new Map();
    this.cacheTimeout = 10 * 60 * 1000; // 10 minutes
  }

  /**
   * Find all PRs related to a specific ticket
   * @param {string} ticketKey - Jira ticket key (e.g., "JAR-123")
   * @param {string} repoSlug - Repository name/slug
   * @param {Object} [options] - Additional options
   * @param {string[]} [options.states] - PR states to include (default: ['OPEN', 'MERGED'])
   * @param {number} [options.maxResults] - Maximum number of PRs to analyze (default: 100)
   * @returns {Promise<Object>} Result with PR matches and confidence scores
   */
  async findPRsForTicket(ticketKey, repoSlug, options = {}) {
    try {
      const { states = ['OPEN', 'MERGED'], maxResults = 100 } = options;
      const cacheKey = `pr-ticket:${ticketKey}:${repoSlug}:${states.join(',')}`;
      
      // Check cache first
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        return { success: true, data: cached, fromCache: true };
      }

      // Fetch remote links from Jira first (highest confidence)
      const remoteLinksResult = await this.checkJiraRemoteLinks(ticketKey);
      const officialPRs = remoteLinksResult.success ? remoteLinksResult.data : [];

      // Fetch PRs from Bitbucket
      const prResults = [];
      let page = 1;
      let totalFetched = 0;

      while (totalFetched < maxResults) {
        const pageSize = Math.min(50, maxResults - totalFetched);
        
        for (const state of states) {
          const prResponse = await this.bitbucketClient.fetchPullRequests(repoSlug, {
            state,
            page,
            pagelen: pageSize
          });

          if (!prResponse.success) {
            // If Bitbucket fails, return official links only
            if (officialPRs.length > 0) {
              const result = { ticketKey, pullRequests: officialPRs };
              this.setCache(cacheKey, result);
              return { success: true, data: result, fromCache: false };
            }
            return prResponse;
          }

          prResults.push(...prResponse.data.pullRequests);
          totalFetched += prResponse.data.pullRequests.length;

          // Stop if no more pages
          if (!prResponse.data.pagination.next) {
            break;
          }
        }

        page++;
        
        // Stop if we've fetched enough or no more results
        if (totalFetched >= maxResults) {
          break;
        }
      }

      // Analyze each PR for ticket relationships
      const matchedPRs = [];
      
      for (const pr of prResults) {
        const match = await this.analyzePRForTicket(pr, ticketKey, repoSlug);
        if (match.confidence > 0) {
          matchedPRs.push(match);
        }
      }

      // Merge official PRs with analyzed matches (remove duplicates, prefer higher confidence)
      const allMatches = [...officialPRs];
      
      for (const match of matchedPRs) {
        const existingIndex = allMatches.findIndex(existing => existing.id === match.id);
        if (existingIndex >= 0) {
          // Keep the match with higher confidence
          if (match.confidence > allMatches[existingIndex].confidence) {
            allMatches[existingIndex] = match;
          }
        } else {
          allMatches.push(match);
        }
      }

      // Sort by confidence score (highest first)
      allMatches.sort((a, b) => b.confidence - a.confidence);

      const result = {
        ticketKey,
        pullRequests: allMatches
      };

      this.setCache(cacheKey, result);
      return { success: true, data: result, fromCache: false };

    } catch (error) {
      return {
        success: false,
        error: {
          code: 'PR_TICKET_MATCHER_ERROR',
          message: `Failed to find PRs for ticket ${ticketKey}: ${error.message}`
        }
      };
    }
  }

  /**
   * Find tickets mentioned in a specific PR (reverse lookup)
   * @param {number} prId - Pull request ID
   * @param {string} repoSlug - Repository name/slug
   * @returns {Promise<Object>} Result with ticket matches
   */
  async findTicketsForPR(prId, repoSlug) {
    try {
      const cacheKey = `ticket-pr:${prId}:${repoSlug}`;
      
      // Check cache first
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        return { success: true, data: cached, fromCache: true };
      }

      // Fetch PR details
      const prResponse = await this.bitbucketClient.fetchPullRequests(repoSlug, {
        state: 'OPEN,MERGED,DECLINED'
      });

      if (!prResponse.success) {
        return prResponse;
      }

      const pr = prResponse.data.pullRequests.find(p => p.id === prId);
      if (!pr) {
        return {
          success: false,
          error: {
            code: 'PR_NOT_FOUND',
            message: `Pull request ${prId} not found in repository ${repoSlug}`
          }
        };
      }

      // Extract ticket references from PR
      const ticketMatches = await this.extractTicketReferences(pr, repoSlug);

      const result = {
        prId,
        repoSlug,
        tickets: ticketMatches
      };

      this.setCache(cacheKey, result);
      return { success: true, data: result, fromCache: false };

    } catch (error) {
      return {
        success: false,
        error: {
          code: 'PR_TICKET_MATCHER_ERROR',
          message: `Failed to find tickets for PR ${prId}: ${error.message}`
        }
      };
    }
  }

  /**
   * Efficient bulk matching for multiple tickets
   * @param {string[]} ticketKeys - Array of Jira ticket keys
   * @param {string} repoSlug - Repository name/slug
   * @param {Object} [options] - Additional options
   * @returns {Promise<Object>} Result with bulk matches
   */
  async batchMatchTickets(ticketKeys, repoSlug, options = {}) {
    try {
      const { states = ['OPEN', 'MERGED'], maxResults = 200 } = options;
      
      // Fetch all PRs once for efficiency
      const allPRs = [];
      let page = 1;
      let totalFetched = 0;

      while (totalFetched < maxResults) {
        const pageSize = Math.min(50, maxResults - totalFetched);
        
        for (const state of states) {
          const prResponse = await this.bitbucketClient.fetchPullRequests(repoSlug, {
            state,
            page,
            pagelen: pageSize
          });

          if (!prResponse.success) {
            return prResponse;
          }

          allPRs.push(...prResponse.data.pullRequests);
          totalFetched += prResponse.data.pullRequests.length;

          if (!prResponse.data.pagination.next) {
            break;
          }
        }

        page++;
        if (totalFetched >= maxResults) {
          break;
        }
      }

      // Analyze each ticket against all PRs
      const results = {};
      
      for (const ticketKey of ticketKeys) {
        const matchedPRs = [];
        
        // Check official Jira links first
        const remoteLinksResult = await this.checkJiraRemoteLinks(ticketKey);
        if (remoteLinksResult.success) {
          matchedPRs.push(...remoteLinksResult.data);
        }

        // Analyze PRs for this ticket
        for (const pr of allPRs) {
          const match = await this.analyzePRForTicket(pr, ticketKey, repoSlug);
          if (match.confidence > 0) {
            // Check for duplicates with official links
            const existingIndex = matchedPRs.findIndex(existing => existing.id === match.id);
            if (existingIndex >= 0) {
              if (match.confidence > matchedPRs[existingIndex].confidence) {
                matchedPRs[existingIndex] = match;
              }
            } else {
              matchedPRs.push(match);
            }
          }
        }

        // Sort by confidence
        matchedPRs.sort((a, b) => b.confidence - a.confidence);
        
        results[ticketKey] = {
          ticketKey,
          pullRequests: matchedPRs
        };
      }

      return { success: true, data: results, fromCache: false };

    } catch (error) {
      return {
        success: false,
        error: {
          code: 'PR_TICKET_MATCHER_ERROR',
          message: `Failed to batch match tickets: ${error.message}`
        }
      };
    }
  }

  /**
   * Analyze a single PR for relationship to a specific ticket
   * @param {Object} pr - Pull request object from Bitbucket API
   * @param {string} ticketKey - Jira ticket key
   * @param {string} repoSlug - Repository name/slug
   * @returns {Promise<Object>} PR object with confidence score and match sources
   */
  async analyzePRForTicket(pr, ticketKey, repoSlug) {
    const matchSources = [];
    let confidence = 0;

    // Analyze branch name
    const branchScore = this.analyzeBranchName(pr.source?.branch?.name || '', ticketKey);
    if (branchScore > 0) {
      confidence = Math.max(confidence, branchScore);
      matchSources.push('branch-name');
    }

    // Analyze PR title
    const titleScore = this.analyzeText(pr.title || '', ticketKey);
    if (titleScore > 0) {
      confidence = Math.max(confidence, titleScore);
      matchSources.push('pr-title');
    }

    // Analyze PR description
    const descScore = this.analyzeText(pr.description || '', ticketKey);
    if (descScore > 0) {
      confidence = Math.max(confidence, Math.min(descScore, CONFIDENCE_THRESHOLDS.COMMIT_MESSAGE));
      matchSources.push('pr-description');
    }

    // Analyze commit messages
    const commitScore = await this.analyzeCommitMessages(pr, ticketKey, repoSlug);
    if (commitScore > 0) {
      confidence = Math.max(confidence, commitScore);
      matchSources.push('commit-message');
    }

    // Return enhanced PR object if there's a match
    if (confidence > 0) {
      return {
        id: pr.id,
        title: pr.title,
        status: pr.state,
        url: pr.links?.html?.href || `https://bitbucket.org/${this.bitbucketClient.config.workspace}/${repoSlug}/pull-requests/${pr.id}`,
        branch: pr.source?.branch?.name,
        commits: pr.commit_count || 0,
        filesChanged: pr.diff_stats?.files_changed || 0,
        createdDate: pr.created_on,
        updatedDate: pr.updated_on,
        author: pr.author?.display_name || pr.author?.nickname,
        confidence,
        matchSources
      };
    }

    return { confidence: 0 };
  }

  /**
   * Extract ticket references from a PR (title, description, commits)
   * @param {Object} pr - Pull request object
   * @param {string} repoSlug - Repository name/slug
   * @returns {Promise<Array>} Array of ticket matches with confidence scores
   */
  async extractTicketReferences(pr, repoSlug) {
    const tickets = new Map(); // Use Map to avoid duplicates

    // Extract from PR title
    const titleTickets = this.extractTicketsFromText(pr.title || '');
    titleTickets.forEach(ticket => {
      tickets.set(ticket, {
        ticketKey: ticket,
        confidence: CONFIDENCE_THRESHOLDS.COMMIT_TITLE,
        sources: ['pr-title']
      });
    });

    // Extract from PR description
    const descTickets = this.extractTicketsFromText(pr.description || '');
    descTickets.forEach(ticket => {
      if (tickets.has(ticket)) {
        tickets.get(ticket).sources.push('pr-description');
      } else {
        tickets.set(ticket, {
          ticketKey: ticket,
          confidence: CONFIDENCE_THRESHOLDS.COMMIT_MESSAGE,
          sources: ['pr-description']
        });
      }
    });

    // Extract from branch name
    const branchTickets = this.extractTicketsFromBranch(pr.source?.branch?.name || '');
    branchTickets.forEach(ticket => {
      if (tickets.has(ticket)) {
        tickets.get(ticket).confidence = Math.max(
          tickets.get(ticket).confidence,
          CONFIDENCE_THRESHOLDS.BRANCH_PATTERN
        );
        tickets.get(ticket).sources.push('branch-name');
      } else {
        tickets.set(ticket, {
          ticketKey: ticket,
          confidence: CONFIDENCE_THRESHOLDS.BRANCH_PATTERN,
          sources: ['branch-name']
        });
      }
    });

    // Extract from commits
    const commitTickets = await this.extractTicketsFromCommits(pr, repoSlug);
    commitTickets.forEach(ticket => {
      if (tickets.has(ticket.ticketKey)) {
        tickets.get(ticket.ticketKey).confidence = Math.max(
          tickets.get(ticket.ticketKey).confidence,
          ticket.confidence
        );
        if (!tickets.get(ticket.ticketKey).sources.includes('commit-message')) {
          tickets.get(ticket.ticketKey).sources.push('commit-message');
        }
      } else {
        tickets.set(ticket.ticketKey, ticket);
      }
    });

    return Array.from(tickets.values());
  }

  /**
   * Analyze commit messages for ticket references
   * @param {Object} pr - Pull request object
   * @param {string} ticketKey - Jira ticket key to look for
   * @param {string} repoSlug - Repository name/slug
   * @returns {Promise<number>} Confidence score (0-100)
   */
  async analyzeCommitMessages(pr, ticketKey, repoSlug) {
    try {
      const commitsResponse = await this.bitbucketClient.fetchPRCommits(repoSlug, pr.id);
      
      if (!commitsResponse.success) {
        return 0;
      }

      const commits = commitsResponse.data.commits || [];
      let maxScore = 0;

      for (const commit of commits) {
        const message = commit.message || '';
        const score = this.analyzeText(message, ticketKey);
        maxScore = Math.max(maxScore, score);
      }

      return maxScore;

    } catch (error) {
      // If commit fetching fails, don't fail the entire analysis
      return 0;
    }
  }

  /**
   * Extract ticket references from commit messages
   * @param {Object} pr - Pull request object
   * @param {string} repoSlug - Repository name/slug
   * @returns {Promise<Array>} Array of ticket matches from commits
   */
  async extractTicketsFromCommits(pr, repoSlug) {
    try {
      const commitsResponse = await this.bitbucketClient.fetchPRCommits(repoSlug, pr.id);
      
      if (!commitsResponse.success) {
        return [];
      }

      const commits = commitsResponse.data.commits || [];
      const tickets = new Map();

      for (const commit of commits) {
        const message = commit.message || '';
        const commitTickets = this.extractTicketsFromText(message);
        
        commitTickets.forEach(ticket => {
          if (tickets.has(ticket)) {
            // Keep highest confidence
            tickets.get(ticket).confidence = Math.max(
              tickets.get(ticket).confidence,
              CONFIDENCE_THRESHOLDS.COMMIT_MESSAGE
            );
          } else {
            tickets.set(ticket, {
              ticketKey: ticket,
              confidence: CONFIDENCE_THRESHOLDS.COMMIT_MESSAGE,
              sources: ['commit-message']
            });
          }
        });
      }

      return Array.from(tickets.values());

    } catch (error) {
      return [];
    }
  }

  /**
   * Analyze branch name for ticket reference
   * @param {string} branchName - Branch name to analyze
   * @param {string} ticketKey - Jira ticket key to look for
   * @returns {number} Confidence score (0-100)
   */
  analyzeBranchName(branchName, ticketKey) {
    if (!branchName || !ticketKey) {
      return 0;
    }

    const upperBranch = branchName.toUpperCase();
    const upperTicket = ticketKey.toUpperCase();

    // Check for exact patterns (case insensitive)
    for (const pattern of BRANCH_PATTERNS) {
      const match = upperBranch.match(pattern);
      if (match && match[1] === upperTicket) {
        return CONFIDENCE_THRESHOLDS.EXACT_BRANCH;
      }
    }

    // Check for ticket anywhere in branch name
    if (upperBranch.includes(upperTicket)) {
      return CONFIDENCE_THRESHOLDS.BRANCH_PATTERN;
    }

    return 0;
  }

  /**
   * Analyze text (commit message, PR title, etc.) for ticket reference
   * @param {string} text - Text to analyze
   * @param {string} ticketKey - Jira ticket key to look for
   * @returns {number} Confidence score (0-100)
   */
  analyzeText(text, ticketKey) {
    if (!text || !ticketKey) {
      return 0;
    }

    const upperText = text.toUpperCase();
    const upperTicket = ticketKey.toUpperCase();

    // Check for structured patterns (highest confidence) - case insensitive
    // Skip the last pattern which is for extraction only
    for (let i = 0; i < TICKET_PATTERNS.length - 1; i++) {
      const pattern = TICKET_PATTERNS[i];
      const match = upperText.match(pattern);
      if (match && match[1] === upperTicket) {
        // Higher confidence for patterns at the start
        if (pattern.source.includes('^')) {
          return CONFIDENCE_THRESHOLDS.COMMIT_TITLE;
        }
        return CONFIDENCE_THRESHOLDS.COMMIT_MESSAGE;
      }
    }

    // Check for ticket anywhere in text (lower confidence)
    if (upperText.includes(upperTicket)) {
      return CONFIDENCE_THRESHOLDS.PARTIAL_MATCH;
    }

    return 0;
  }

  /**
   * Extract all ticket references from text
   * @param {string} text - Text to analyze
   * @returns {Array<string>} Array of ticket keys found
   */
  extractTicketsFromText(text) {
    if (!text) {
      return [];
    }

    const tickets = new Set();

    // Use all patterns to find tickets
    for (const pattern of TICKET_PATTERNS) {
      const matches = text.matchAll(new RegExp(pattern, 'g'));
      for (const match of matches) {
        if (match[1]) {
          tickets.add(match[1].toUpperCase());
        }
      }
    }

    return Array.from(tickets);
  }

  /**
   * Extract ticket references from branch name
   * @param {string} branchName - Branch name to analyze
   * @returns {Array<string>} Array of ticket keys found
   */
  extractTicketsFromBranch(branchName) {
    if (!branchName) {
      return [];
    }

    const tickets = new Set();

    // Use branch-specific patterns
    for (const pattern of BRANCH_PATTERNS) {
      const match = branchName.match(pattern);
      if (match && match[1]) {
        tickets.add(match[1].toUpperCase());
      }
    }

    return Array.from(tickets);
  }

  /**
   * Check Jira remote links for official Bitbucket-Jira connections
   * @param {string} ticketKey - Jira ticket key
   * @returns {Promise<Object>} Result with official PR links
   */
  async checkJiraRemoteLinks(ticketKey) {
    try {
      // Use the Jira client to fetch remote links
      const remoteLinksResult = await this.jiraClient.fetchRemoteLinks(ticketKey);
      
      if (!remoteLinksResult.success) {
        return { success: true, data: [] }; // Not an error, just no links
      }

      const remoteLinks = remoteLinksResult.data || [];
      const bitbucketPRs = [];

      for (const link of remoteLinks) {
        const url = link.object?.url || '';
        
        // Check if this is a Bitbucket PR URL
        const prMatch = url.match(/bitbucket\.org\/([^\/]+)\/([^\/]+)\/pull-requests\/(\d+)/);
        if (prMatch) {
          const [, workspace, repo, prId] = prMatch;
          
          bitbucketPRs.push({
            id: parseInt(prId, 10),
            title: link.object?.title || `PR #${prId}`,
            status: 'UNKNOWN', // We'd need to fetch from Bitbucket to get status
            url: url,
            branch: 'unknown',
            commits: 0,
            filesChanged: 0,
            createdDate: null,
            updatedDate: null,
            author: null,
            confidence: CONFIDENCE_THRESHOLDS.OFFICIAL_LINK,
            matchSources: ['jira-link']
          });
        }
      }

      return { success: true, data: bitbucketPRs };

    } catch (error) {
      // If remote links fetching fails, continue without official links
      return { success: true, data: [] };
    }
  }

  /**
   * Cache management methods
   */
  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    this.cache.delete(key);
    return null;
  }

  setCache(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  clearCache() {
    this.cache.clear();
  }
} 