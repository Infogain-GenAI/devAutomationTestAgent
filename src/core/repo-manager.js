'use strict';

const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const { createClient, createPullRequest, parseRepoIdentifier } = require('../utils/github-client');

class RepoManager {
  constructor(config) {
    this.config = config;
    this.workDir = null;
    this.git = null;
    this.octokit = createClient(config);
  }

  /**
   * PRIMARY (GitHub Actions): Use the workspace already checked out by actions/checkout.
   * Validates the directory is a valid git repo.
   */
  async useLocalWorkspace(workDir) {
    logger.info(`Using local workspace: ${workDir}`);

    if (!fs.existsSync(workDir)) {
      throw new Error(`Workspace directory does not exist: ${workDir}`);
    }

    const gitDir = path.join(workDir, '.git');
    if (!fs.existsSync(gitDir)) {
      throw new Error(`Not a git repository: ${workDir}`);
    }

    this.workDir = workDir;
    this.git = simpleGit(workDir);

    const status = await this.git.status();
    logger.info(`Local workspace ready: branch=${status.current}, clean=${status.isClean()}`);
    return { branch: status.current, isClean: status.isClean() };
  }

  /**
   * SECONDARY (API mode): Clone a repository from GitHub with auth token.
   */
  async cloneRepo(repoUrl, workDir, token) {
    logger.info(`Cloning repository: ${repoUrl}`);

    if (fs.existsSync(workDir)) {
      logger.warn(`Work directory already exists, cleaning: ${workDir}`);
      fs.rmSync(workDir, { recursive: true, force: true });
    }

    fs.mkdirSync(workDir, { recursive: true });

    // Embed token in URL for authentication
    const authedUrl = repoUrl.replace('https://', `https://x-access-token:${token}@`);
    const git = simpleGit();
    await git.clone(authedUrl, workDir);

    this.workDir = workDir;
    this.git = simpleGit(workDir);

    logger.info('Repository cloned successfully');
    return this.workDir;
  }

  /**
   * Create and checkout a new branch from the configured base branch.
   */
  async createBranch(branchName) {
    const baseBranch = this.config.agent.branch || 'main';
    logger.info(`Creating branch: ${branchName} from ${baseBranch}`);

    // Ensure we're on the base branch first
    try {
      await this.git.checkout(baseBranch);
    } catch (err) {
      logger.warn(`Could not checkout ${baseBranch}, using current branch: ${err.message}`);
    }

    await this.git.checkoutLocalBranch(branchName);
    logger.info(`Checked out branch: ${branchName}`);
    return branchName;
  }

  /**
   * Stage and commit specific files.
   */
  async commitChanges(message, files) {
    logger.info(`Committing: ${message} (${files.length} files)`);
    await this.git.add(files);
    const result = await this.git.commit(message);
    logger.info(`Committed: ${result.commit}`);
    return result;
  }

  /**
   * Push branch to remote origin.
   */
  async pushBranch(branchName) {
    logger.info(`Pushing branch: ${branchName}`);
    await this.git.push('origin', branchName, ['--set-upstream']);
    logger.info(`Branch pushed: ${branchName}`);
  }

  /**
   * Create a Pull Request in the same repository.
   */
  async createPR({ title, body, head, base }) {
    const repoInfo = parseRepoIdentifier(
      this.config.repoUrl || process.env.GITHUB_REPOSITORY
    );

    const pr = await createPullRequest(this.octokit, {
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      title,
      body,
      head,
      base: base || this.config.agent.branch || 'main'
    });

    return pr;
  }

  /**
   * Get list of changed files.
   */
  async getChangedFiles() {
    const status = await this.git.status();
    return [
      ...status.modified,
      ...status.not_added,
      ...status.created
    ];
  }

  /**
   * Cleanup cloned directory (API mode only).
   */
  async cleanup() {
    if (this.workDir && fs.existsSync(this.workDir)) {
      logger.info(`Cleaning up workspace: ${this.workDir}`);
      fs.rmSync(this.workDir, { recursive: true, force: true });
      this.workDir = null;
    }
  }

  getWorkDir() {
    return this.workDir;
  }
}

module.exports = RepoManager;
