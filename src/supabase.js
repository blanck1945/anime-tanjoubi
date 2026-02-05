/**
 * Supabase — estado de posts por día.
 * Una fila por post (mismo date). Filtrar por date para ver todos los posteos del día.
 */

import { createClient } from '@supabase/supabase-js';

const TABLE = 'daily_posts';
let client = null;

function getClient() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  client = createClient(url, key, { db: { schema: 'public' } });
  return client;
}

/**
 * Get all posts for a date (YYYY-MM-DD)
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<object|null>} { date, preparedAt, posts: [...] }
 */
export async function getDayDoc(date) {
  const supabase = getClient();
  const { data: rows, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('date', date)
    .order('post_index', { ascending: true });
  if (error) throw error;
  if (!rows || rows.length === 0) return null;
  const preparedAt = rows[0]?.prepared_at ?? null;
  const posts = rows.map((r) => ({
    index: r.post_index,
    character: r.character,
    series: r.series,
    scheduledTime: r.scheduled_time ?? '',
    previewText: r.preview_text ?? '',
    imageUrl: r.image_url ?? null,
    status: r.status ?? 'pending',
    postedAt: r.posted_at ?? null,
    tweetUrl: r.tweet_url ?? null,
    error: r.error ?? null
  }));
  return { date, preparedAt, updatedAt: null, posts };
}

/**
 * Save day: delete existing rows for date, insert one row per post
 * @param {object} doc - { date, preparedAt, posts: [...] }
 */
export async function saveDayDoc(doc) {
  if (!doc?.date) throw new Error('doc.date is required');
  const supabase = getClient();
  const preparedAt = doc.preparedAt ?? new Date().toISOString();

  const { error: delError } = await supabase.from(TABLE).delete().eq('date', doc.date);
  if (delError) throw delError;

  const posts = doc.posts ?? [];
  if (posts.length === 0) return;

  const rows = posts.map((p) => ({
    date: doc.date,
    post_index: p.index ?? 0,
    character: p.character ?? '',
    series: p.series ?? '',
    scheduled_time: p.scheduledTime ?? '',
    preview_text: p.previewText ?? '',
    image_url: p.imageUrl ?? null,
    status: p.status ?? 'pending',
    posted_at: p.postedAt ?? null,
    tweet_url: p.tweetUrl ?? null,
    error: p.error ?? null,
    prepared_at: preparedAt
  }));

  const { error: insError } = await supabase.from(TABLE).insert(rows);
  if (insError) throw insError;
}

/**
 * Update a single post status (for post step)
 * @param {string} date - YYYY-MM-DD
 * @param {number} index - post index 0..5
 * @param {object} update - { status?, postedAt?, tweetUrl?, error? }
 */
export async function updatePostStatus(date, index, update) {
  const supabase = getClient();
  const set = {};
  if (update.status != null) set.status = update.status;
  if (update.postedAt != null) set.posted_at = update.postedAt;
  if (update.tweetUrl != null) set.tweet_url = update.tweetUrl;
  if (update.error != null) set.error = update.error;
  if (Object.keys(set).length === 0) return;

  const { error } = await supabase
    .from(TABLE)
    .update(set)
    .eq('date', date)
    .eq('post_index', index);
  if (error) throw error;
}

/**
 * List dates that have at least one post (for frontend / last 7 days)
 * @param {number} limit
 * @returns {Promise<string[]>} array of YYYY-MM-DD
 */
export async function getAvailableDates(limit = 7) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select('date')
    .order('date', { ascending: false });
  if (error) throw error;
  const seen = new Set();
  const dates = [];
  for (const r of data || []) {
    if (seen.has(r.date)) continue;
    seen.add(r.date);
    dates.push(r.date);
    if (dates.length >= limit) break;
  }
  return dates;
}

/**
 * Close client (no-op for Supabase; kept for API compatibility)
 */
export async function closeMongo() {
  client = null;
}

export default {
  getDayDoc,
  saveDayDoc,
  updatePostStatus,
  getAvailableDates,
  closeMongo
};
