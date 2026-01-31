/**
 * Usage Tracker for Twitter API credits
 *
 * Tracks posts in memory and logs for Railway deployment.
 * Railway doesn't have persistent filesystem, so this logs to stdout
 * which can be viewed in Railway Dashboard logs.
 *
 * Budget tracking:
 * - $5 credits = 500 posts ($0.01/post)
 * - 5 posts/day = 100 days of operation
 */

let sessionStats = {
  postsThisSession: 0,
  sessionStart: new Date().toISOString(),
  posts: []
};

// Estimated total from environment (user can set this)
const TOTAL_BUDGET_POSTS = parseInt(process.env.TOTAL_BUDGET_POSTS || '500', 10);
const COST_PER_POST = 0.01;

/**
 * Record a successful post
 * @param {object} postInfo - Info about the post
 */
export function recordPost(postInfo = {}) {
  sessionStats.postsThisSession++;

  const record = {
    timestamp: new Date().toISOString(),
    sessionPostNumber: sessionStats.postsThisSession,
    ...postInfo
  };

  sessionStats.posts.push(record);

  // Log for Railway dashboard visibility
  console.log('=== POST RECORDED ===');
  console.log(`Session posts: ${sessionStats.postsThisSession}`);
  console.log(`Character: ${postInfo.characterName || 'Unknown'}`);
  console.log(`Tweet ID: ${postInfo.tweetId || 'N/A'}`);
  console.log(`Estimated cost: $${(sessionStats.postsThisSession * COST_PER_POST).toFixed(2)}`);
  console.log('=====================');

  return record;
}

/**
 * Get current session statistics
 */
export function getSessionStats() {
  return {
    ...sessionStats,
    estimatedCost: sessionStats.postsThisSession * COST_PER_POST,
    budgetRemaining: TOTAL_BUDGET_POSTS - sessionStats.postsThisSession,
    budgetRemainingDollars: (TOTAL_BUDGET_POSTS - sessionStats.postsThisSession) * COST_PER_POST
  };
}

/**
 * Log a summary of usage (call periodically or on shutdown)
 */
export function logUsageSummary() {
  const stats = getSessionStats();

  console.log('\n========================================');
  console.log('       USAGE SUMMARY');
  console.log('========================================');
  console.log(`Session started: ${stats.sessionStart}`);
  console.log(`Posts this session: ${stats.postsThisSession}`);
  console.log(`Estimated session cost: $${stats.estimatedCost.toFixed(2)}`);
  console.log(`Budget: ${TOTAL_BUDGET_POSTS} posts ($${(TOTAL_BUDGET_POSTS * COST_PER_POST).toFixed(2)})`);
  console.log('----------------------------------------');
  console.log(`Note: Track total usage manually or via`);
  console.log(`Twitter API dashboard for accurate count.`);
  console.log('========================================\n');

  return stats;
}

/**
 * Check if we should warn about budget
 * @returns {boolean} True if budget is getting low
 */
export function shouldWarnBudget() {
  // Warn when 80% of budget used (based on session only)
  // User should check actual Twitter API usage
  return sessionStats.postsThisSession > TOTAL_BUDGET_POSTS * 0.8;
}

export default {
  recordPost,
  getSessionStats,
  logUsageSummary,
  shouldWarnBudget
};
