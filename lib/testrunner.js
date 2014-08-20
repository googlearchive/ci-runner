'use strict';

var _       = require('underscore');
var async   = require('async');
var chalk   = require('chalk');
var github  = require('github');
var shelljs = require('shelljs');

var exec = require('./exec');

function TestRunner(commit, fbStatus, github, repos, log) {
  this._commit   = commit;
  this._fbStatus = fbStatus;
  this._github   = github;
  this._repos    = repos;
  this._log      = log;

  // TODO(nevir): Configurable.
  this._reportUrl = 'http://polymerlabs.github.io/ci-runner/#' + commit.key;

  this._root; // _createTempDir
}

TestRunner.prototype.run = function run(done) {
  async.series([
    this._logEntry('info', 'Starting test run'),

    this._logEntry('group', 'Setup'),
    this.setCommitStatus.bind(this, 'pending', 'Cloning'),
    this._fetchRepo.bind(this),
    this.setCommitStatus.bind(this, 'pending', 'Fetching Dependencies'),
    this._npmInstall.bind(this),
    this._logEntry('groupEnd'),

    this._logEntry('group', 'Testing'),
    this.setCommitStatus.bind(this, 'pending', 'Spinning Up'),
    this._runGrunt.bind(this),
    this._logEntry('groupEnd'),

    this._logEntry('info', 'Test run complete'),

  ], function(failure) {
    this._cleanup(function() {
      this.setCommitStatus(failure ? 'failed' : 'success', '');
      if (failure) this._emitFailure(failure);
      done(failure);
    }.bind(this));
  }.bind(this));
};

TestRunner.prototype.setCommitStatus = function setCommitStatus(state, text, next) {
  this._log.info('Setting commit status to', chalk.yellow(state) + ':', chalk.blue(text));
  this._commitStatus = {state: state, text: text};

  this._fbStatus.child('status').set(this._commitStatus);

  this._github.statuses.create({
    user:        this._commit.user,
    repo:        this._commit.repo,
    sha:         this._commit.sha,
    state:       state,
    description: text,
    target_url:  this._reportUrl,
  }, next);
};

// Steps

// TODO(nevir): Cache bare repos and pull diffs from there.
TestRunner.prototype._fetchRepo = function _fetchRepo(next) {
  this._repos.clone(this._commit, this._log, function(error, path) {
    this._root = path;
    next(error);
  }.bind(this));
};

// TODO(nevir): Cache npm packages.
TestRunner.prototype._npmInstall = function _npmInstall(next) {
  exec(this._log, 'npm', ['install'], this._root, next);
};

TestRunner.prototype._runGrunt = function _runGrunt(next) {
  exec(this._log, 'grunt', [], this._root, next);
};

TestRunner.prototype._cleanup = function _cleanup(next) {
  if (this._root) shelljs.rm('-rf', this._root);
  next();
};

TestRunner.prototype._emitFailure = function _emitFailure(failure) {
  this._log.error(failure);

  if (_(this._commentBranches).contains(this._commit.branch)) {
    github.repos.createCommitComment({
      user:      this._commit.user,
      repo:      this._commit.repo,
      sha:       this._commit.sha,
      commit_id: this._commit.sha, // Err what?
      body: '[Test Failure](' + this._reportUrl + '):\n---\n' + failure,
    });
  }
};

// Util

TestRunner.prototype._logEntry = function _logEntry(kind) {
  var args = Array.prototype.slice.call(arguments, 1, arguments.length);
  return function(next) {
    this._log[kind].apply(this._log, args);
    next();
  }.bind(this);
};

module.exports = TestRunner;
