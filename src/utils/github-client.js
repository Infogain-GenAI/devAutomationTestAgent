'use strict';

const { Octokit } = require('@octokit/rest');
const { createAppAuth } = require('@octokit/auth-app');
const logger = require('./logger');

/**
 * Create an authenticated Octokit client.
 * Supports PAT and GitHub App authentication.
 */
function createClient(config) {
  const { authMethod } = config.github;

  if (authMethod === 'app') {
    logger.info('Initializing GitHub client with App authentication');
    return new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: config.github.appId,
        privateKey: config.github.privateKey,
        installationId: config.github.installationId
      }
    });
  }

  logger.info('Initializing GitHub client with PAT authentication');
  return new Octokit({ auth: config.github.token });
}

/**
 * Create a pull request.
 */
async function createPullRequest(octokit, { owner, repo, title, body, head, base }) {
  logger.info(`Creating PR: ${head} → ${base} in ${owner}/${repo}`);
  const { data } = await octokit.pulls.create({
    owner,
    repo,
    title,
    body,
    head,
    base
  });
  logger.info(`PR created: ${data.html_url}`);
  return data;
}

/**
 * Get repository information.
 */
async function getRepoInfo(octokit, owner, repo) {
  const { data } = await octokit.repos.get({ owner, repo });
  return {
    defaultBranch: data.default_branch,
    language: data.language,
    fullName: data.full_name,
    private: data.private,
    description: data.description
  };
}

/**
 * Parse owner/repo from a GitHub URL or GITHUB_REPOSITORY env var.
 */
function parseRepoIdentifier(input) {
  if (!input) {
    // Fallback to GITHUB_REPOSITORY env var (set automatically by GitHub Actions)
    const ghRepo = process.env.GITHUB_REPOSITORY;
    if (ghRepo) {
      const [owner, repo] = ghRepo.split('/');
      return { owner, repo };
    }
    throw new Error('Cannot determine repository. Provide repoUrl or set GITHUB_REPOSITORY.');
  }

  // Handle full URL: https://github.com/owner/repo or https://github.com/owner/repo.git
  const urlMatch = input.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2] };
  }

  // Handle owner/repo format
  if (input.includes('/')) {
    const [owner, repo] = input.split('/');
    return { owner, repo };
  }

  throw new Error(`Cannot parse repository from: ${input}`);
}

module.exports = { createClient, createPullRequest, getRepoInfo, parseRepoIdentifier };
