import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// En Railway usa el volumen montado en /data, en local usa ./data
const DATA_DIR = process.env.RAILWAY_ENVIRONMENT
  ? '/data'
  : path.join(__dirname, '..', 'data');

console.log(`[State] Using data directory: ${DATA_DIR} (Railway: ${!!process.env.RAILWAY_ENVIRONMENT})`);

// Argentina timezone
const ARGENTINA_TZ = 'America/Argentina/Buenos_Aires';

/**
 * Get today's date string in YYYY-MM-DD format (Argentina time)
 */
function getTodayDateString() {
  return new Date().toLocaleDateString('en-CA', { timeZone: ARGENTINA_TZ });
}

/**
 * Get the state file path for a specific date
 */
function getStateFilePath(dateString = getTodayDateString()) {
  return path.join(DATA_DIR, `posts-${dateString}.json`);
}

/**
 * Load state from file
 * @param {string} dateString - Optional date string (YYYY-MM-DD)
 */
export async function loadState(dateString = getTodayDateString()) {
  const filePath = getStateFilePath(dateString);

  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    console.error(`Error loading state from ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Save state to file
 * @param {object} state - State object to save
 */
export async function saveState(state) {
  const filePath = getStateFilePath(state.date);

  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
    console.log(`State saved to ${filePath}`);
  } catch (error) {
    console.error(`Error saving state to ${filePath}:`, error.message);
    throw error;
  }
}

/**
 * Initialize state for today with prepared posts
 * @param {Array} posts - Array of post data from preparePostsWithImages
 * @param {Array} postTimes - Array of {hour, minute} objects
 */
export async function initializeTodaysState(posts, postTimes) {
  const todayDate = getTodayDateString();

  // Check if we already have state for today
  const existingState = await loadState(todayDate);
  if (existingState) {
    console.log(`State for ${todayDate} already exists, merging...`);
    return mergeState(existingState, posts, postTimes);
  }

  const state = {
    date: todayDate,
    preparedAt: new Date().toISOString(),
    posts: posts.map((post, index) => ({
      index,
      acdbId: post.acdbId ?? null,
      character: post.character.name,
      series: post.character.series,
      scheduledTime: formatTime(postTimes[index]),
      status: 'pending',
      postedAt: null,
      tweetId: null,
      tweetUrl: null
    }))
  };

  await saveState(state);
  return state;
}

/**
 * Merge existing state with new posts (preserves posted status)
 */
function mergeState(existingState, posts, postTimes) {
  const newState = {
    ...existingState,
    posts: posts.map((post, index) => {
      const existingPost = existingState.posts.find(
        p => p.index === index && p.character === post.character.name
      );

      if (existingPost && existingPost.status === 'posted') {
        return existingPost;
      }

      return {
        index,
        acdbId: post.acdbId ?? existingPost?.acdbId ?? null,
        character: post.character.name,
        series: post.character.series,
        scheduledTime: formatTime(postTimes[index]),
        status: existingPost?.status || 'pending',
        postedAt: existingPost?.postedAt || null,
        tweetId: existingPost?.tweetId || null,
        tweetUrl: existingPost?.tweetUrl || null
      };
    })
  };

  saveState(newState);
  return newState;
}

/**
 * Format time object to HH:MM string
 */
function formatTime(timeObj) {
  if (!timeObj) return 'N/A';
  return `${timeObj.hour.toString().padStart(2, '0')}:${timeObj.minute.toString().padStart(2, '0')}`;
}

/**
 * Check if a post has already been sent
 * @param {number} index - Post index
 */
export async function isPostAlreadySent(index) {
  const state = await loadState();
  if (!state || !state.posts[index]) {
    return false;
  }
  return state.posts[index].status === 'posted';
}

/**
 * Mark a post as sent
 * @param {number} index - Post index
 * @param {string} tweetId - Tweet ID
 * @param {string} tweetUrl - Tweet URL
 */
export async function markPostAsSent(index, tweetId, tweetUrl) {
  const state = await loadState();
  if (!state) {
    console.error('No state found for today');
    return;
  }

  if (state.posts[index]) {
    state.posts[index].status = 'posted';
    state.posts[index].postedAt = new Date().toISOString();
    state.posts[index].tweetId = tweetId;
    state.posts[index].tweetUrl = tweetUrl;
    await saveState(state);
    console.log(`Marked post ${index} as sent: ${tweetUrl}`);
  }
}

/**
 * Mark a post as failed
 * @param {number} index - Post index
 * @param {string} error - Error message
 */
export async function markPostAsFailed(index, error) {
  const state = await loadState();
  if (!state) {
    console.error('No state found for today');
    return;
  }

  if (state.posts[index]) {
    state.posts[index].status = 'error';
    state.posts[index].error = error;
    state.posts[index].lastAttempt = new Date().toISOString();
    await saveState(state);
    console.log(`Marked post ${index} as failed: ${error}`);
  }
}

/**
 * Get current state for dashboard
 */
export async function getCurrentState() {
  const state = await loadState();
  if (!state) {
    return {
      date: getTodayDateString(),
      preparedAt: null,
      posts: []
    };
  }
  return state;
}

/**
 * Check if we can recover today's posts from state (same characters, no re-scrape)
 * Returns true if state exists, has posts, and all have acdbId
 */
export async function canRecoverFromState(dateString = getTodayDateString()) {
  const state = await loadState(dateString);
  if (!state || !state.posts || state.posts.length === 0) return false;
  return state.posts.every(p => p.acdbId);
}

/**
 * Clean up old state files (keep last 7 days)
 */
export async function cleanupOldStateFiles() {
  try {
    const files = await fs.readdir(DATA_DIR);
    const stateFiles = files.filter(f => f.startsWith('posts-') && f.endsWith('.json'));

    const today = new Date();
    const cutoffDate = new Date(today);
    cutoffDate.setDate(cutoffDate.getDate() - 7);

    for (const file of stateFiles) {
      const dateMatch = file.match(/posts-(\d{4}-\d{2}-\d{2})\.json/);
      if (dateMatch) {
        const fileDate = new Date(dateMatch[1]);
        if (fileDate < cutoffDate) {
          await fs.unlink(path.join(DATA_DIR, file));
          console.log(`Cleaned up old state file: ${file}`);
        }
      }
    }
  } catch (error) {
    console.error('Error cleaning up old state files:', error.message);
  }
}

export default {
  loadState,
  saveState,
  initializeTodaysState,
  canRecoverFromState,
  isPostAlreadySent,
  markPostAsSent,
  markPostAsFailed,
  getCurrentState,
  cleanupOldStateFiles
};
