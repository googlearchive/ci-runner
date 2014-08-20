'use strict';

var _           = require('underscore');
var async       = require('async');
var BowerConfig = require('bower-config');
var chalk       = require('chalk');
var fs          = require('fs');
var github      = require('github');
var path        = require('path');
var shelljs     = require('shelljs');

var exec = require('./exec');

function TestRunner(commit, fbStatus, github, repos, runners, log) {
  this._commit   = commit;
  this._fbStatus = fbStatus;
  this._github   = github;
  this._repos    = repos;
  this._runners  = runners;
  this._log      = log;

  // TODO(nevir): Configurable.
  this._reportUrl = 'http://polymerlabs.github.io/ci-runner/#' + commit.key;

  this._root;     // _createTempDir
  this._metadata; // _evalMetadata
}

TestRunner.prototype.run = function run(done) {
  async.series([
    this._logEntry('info', 'Starting test run'),

    this._logEntry('group', 'Setup'),
    this.setCommitStatus.bind(this, 'pending', 'Cloning'),
    this._fetchRepo.bind(this),
    this._evalMetadata.bind(this),
    this.setCommitStatus.bind(this, 'pending', 'Fetching Dependencies'),
    this._bowerInstall.bind(this),
    this._logEntry('groupEnd'),

    this._logEntry('group', 'Testing'),
    this.setCommitStatus.bind(this, 'pending', 'Spinning Up'),
    this._runTests.bind(this),
    this._logEntry('groupEnd'),

    this._logEntry('info', 'Test run complete'),

  ], function(error) {
    this._cleanup(function() {
      if (error) {
        this._emitFailure(error);
      }
      done(error);
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

TestRunner.prototype._fetchRepo = function _fetchRepo(next) {
  this._repos.clone(this._commit, this._log, function(error, path) {
    this._root = path;
    next(error ? ['Failed to fetch repo', error] : null);
  }.bind(this));
};

TestRunner.prototype._evalMetadata = function _evalMetadata(next) {
  var metadataPath = path.join(this._root, 'test.json');
  fs.readFile(metadataPath, function(error, data) {
    if (error) return next(['Missing test.json in package root', error]);

    try {
      this._metadata = JSON.parse(data);
    } catch (error) {
      return next(['Failed to parse test.json', error]);
    }

    this._runnerName = this._metadata['test-runner'];
    if (!_.contains(this._runners, this._runnerName)) {
      return next(['Invalid test.json', 'Test runner "' + this._runnerName + "' not whitelisted."]);
    }
    next();
  }.bind(this));
};

TestRunner.prototype._bowerInstall = function _bowerInstall(next) {
  var config = new BowerConfig(this._root);
  config.load();
  var directory = config.toObject().directory;
  if (path.resolve(this._root, directory).indexOf(this._root) !== 0) {
    return next('Bower directories must be within the project dir. Got: ' + directory);
  }

  // Just less to deal with when we're shelling out.
  exec(this._log, 'bower', ['install'], this._root, next);
};

TestRunner.prototype._runTests = function _runTests(next) {
  this._log.info('Executing test runner', chalk.green(this._runnerName));
  // TODO(nevir): Integrate w/ Kevin's test runner work.
};

// Util

TestRunner.prototype._cleanup = function _cleanup(next) {
  if (this._root) shelljs.rm('-rf', this._root);
  next();
};

TestRunner.prototype._emitFailure = function _emitFailure(failure) {
  var status = 'Test run did not complete';
  if (Array.isArray(failure)) {
    status  = failure[0];
    failure = failure[1];
  }

  this.setCommitStatus('error', status);
  this._log.error(failure);

  // TODO(nevir): It'd be better if we just emailed the author directly, to
  // avoid spamming all repo watchers.
  //
  // https://github.com/PolymerLabs/ci-runner/issues/33
  if (_(this._commentBranches).contains(this._commit.branch)) {
    github.repos.createCommitComment({
      user:      this._commit.user,
      repo:      this._commit.repo,
      sha:       this._commit.sha,
      commit_id: this._commit.sha, // Err what?
      body: '[Test Failure](' + this._reportUrl + '): ' + status,
    });
  }
};

TestRunner.prototype._logEntry = function _logEntry(kind) {
  var args = Array.prototype.slice.call(arguments, 1, arguments.length);
  return function(next) {
    this._log[kind].apply(this._log, args);
    next();
  }.bind(this);
};

module.exports = TestRunner;
