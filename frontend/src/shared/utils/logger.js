/* eslint-disable no-console */

/**
 * Dev-only logger — all methods are no-ops in production builds.
 * console.error is securely wrapped to prevent leaks in production.
 */
const isDev = import.meta.env.DEV;

const noop = () => {};

export const logger = {
  debug: isDev ? console.debug.bind(console) : noop,
  log: isDev ? console.log.bind(console) : noop,
  warn: isDev ? console.warn.bind(console) : noop,
  info: isDev ? console.info.bind(console) : noop,
  error: isDev ? console.error.bind(console) : noop,
};
