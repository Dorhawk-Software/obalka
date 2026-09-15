// App build info shown in Settings → About. Keep `APP_VERSION` in sync with package.json on release
// (kept as a plain constant so we don't bundle the whole package.json into the app).
export const APP_VERSION = '0.0.1';

/** The public source repository (the app is MIT - see LICENSE). */
export const REPOSITORY_URL = 'https://github.com/Dorhawk-Software/obalka';
/**
 * Shown beside the row; the bare host+path reads better than the full URL at 13px.
 *
 * DERIVED, not typed out again. These two were separate literals naming the same repository, which
 * is a label that can disagree with the link it sits next to - the kind of drift nobody notices,
 * because the row keeps looking fine while pointing somewhere else.
 */
export const REPOSITORY_LABEL = REPOSITORY_URL.replace(/^https:\/\//, '');
