import schedule from 'node-schedule';

// Argentina timezone (UTC-3)
const ARGENTINA_TZ = 'America/Argentina/Buenos_Aires';

// Post times in Argentina time (24h format)
export const POST_TIMES = [
  { hour: 9, minute: 0 },   // 9:00 AM
  { hour: 12, minute: 0 },  // 12:00 PM
  { hour: 15, minute: 0 },  // 3:00 PM
  { hour: 18, minute: 0 },  // 6:00 PM
  { hour: 21, minute: 0 }   // 9:00 PM
];

// Time to prepare posts (run scraper and download images)
const PREP_TIME = { hour: 8, minute: 30 }; // 8:30 AM Argentina

/**
 * Schedule the daily preparation job
 * This runs once per day to fetch birthdays and prepare posts
 */
export function scheduleDailyPrep(prepCallback) {
  const rule = new schedule.RecurrenceRule();
  rule.hour = PREP_TIME.hour;
  rule.minute = PREP_TIME.minute;
  rule.tz = ARGENTINA_TZ;

  const job = schedule.scheduleJob('daily-prep', rule, async () => {
    console.log(`[${new Date().toISOString()}] Running daily preparation...`);
    try {
      await prepCallback();
      console.log(`[${new Date().toISOString()}] Daily preparation complete.`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Daily preparation failed:`, error.message);
    }
  });

  console.log(`Daily preparation scheduled for ${PREP_TIME.hour}:${PREP_TIME.minute.toString().padStart(2, '0')} (Argentina)`);
  return job;
}

/**
 * Schedule posts at specific times
 * @param {Array} posts - Array of post data objects
 * @param {Function} postCallback - Function to call for each post
 */
export function schedulePosts(posts, postCallback) {
  const jobs = [];
  const now = new Date();

  posts.forEach((post, index) => {
    if (index >= POST_TIMES.length) {
      console.log(`Skipping post ${index + 1} - no more time slots available`);
      return;
    }

    const time = POST_TIMES[index];
    const scheduledTime = getNextTimeInTimezone(time.hour, time.minute, ARGENTINA_TZ);

    // Skip if the time has already passed today
    if (scheduledTime <= now) {
      console.log(`Skipping post for ${post.character?.name || 'unknown'} - time ${time.hour}:${time.minute.toString().padStart(2, '0')} has passed`);
      return;
    }

    const job = schedule.scheduleJob(`post-${index}`, scheduledTime, async () => {
      console.log(`[${new Date().toISOString()}] Posting: ${post.character?.name || 'unknown'}`);
      try {
        await postCallback(post);
        console.log(`[${new Date().toISOString()}] Posted successfully: ${post.character?.name}`);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Failed to post:`, error.message);
      }
    });

    jobs.push({
      job,
      post,
      scheduledTime
    });

    console.log(`Scheduled post for ${post.character?.name} at ${formatTimeInTimezone(scheduledTime, ARGENTINA_TZ)}`);
  });

  return jobs;
}

/**
 * Schedule a single post at a specific time
 */
export function schedulePost(post, time, postCallback) {
  const scheduledTime = getNextTimeInTimezone(time.hour, time.minute, ARGENTINA_TZ);

  const job = schedule.scheduleJob(scheduledTime, async () => {
    console.log(`[${new Date().toISOString()}] Posting scheduled content...`);
    try {
      await postCallback(post);
    } catch (error) {
      console.error('Scheduled post failed:', error.message);
    }
  });

  return { job, scheduledTime };
}

/**
 * Get the next occurrence of a specific time in a timezone
 */
function getNextTimeInTimezone(hour, minute, timezone) {
  const now = new Date();

  // Create a date string for today at the specified time (in Argentina timezone)
  const dateStr = now.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD format
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`;

  // Create date in the target timezone
  const targetTime = new Date(`${dateStr}T${timeStr}`);

  // Adjust for timezone offset
  const localOffset = now.getTimezoneOffset();
  const argentinaOffset = -180; // UTC-3 in minutes

  const offsetDiff = (localOffset - argentinaOffset) * 60 * 1000;
  targetTime.setTime(targetTime.getTime() + offsetDiff);

  // If the time has passed today, schedule for tomorrow
  if (targetTime <= now) {
    targetTime.setDate(targetTime.getDate() + 1);
  }

  return targetTime;
}

/**
 * Format a date in Argentina timezone
 */
function formatTimeInTimezone(date, timezone) {
  return date.toLocaleString('es-AR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

/**
 * Cancel all scheduled jobs
 */
export function cancelAllJobs() {
  const jobNames = Object.keys(schedule.scheduledJobs);
  jobNames.forEach(name => {
    schedule.cancelJob(name);
  });
  console.log(`Cancelled ${jobNames.length} scheduled jobs`);
}

/**
 * Get list of scheduled jobs
 */
export function getScheduledJobs() {
  return Object.entries(schedule.scheduledJobs).map(([name, job]) => ({
    name,
    nextInvocation: job.nextInvocation()
  }));
}

export default {
  scheduleDailyPrep,
  schedulePosts,
  schedulePost,
  cancelAllJobs,
  getScheduledJobs,
  POST_TIMES,
  PREP_TIME,
  ARGENTINA_TZ
};
