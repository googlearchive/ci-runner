'use strict';

var async   = require('async');
var chalk   = require('chalk');
var gift    = require('gift');
var github  = require('github');
var shelljs = require('shelljs');
var tmp     = require('tmp');

var exec = require('./exec');

function TestRunner(commit, fbStatus, github, log) {
  this._commit   = commit;
  this._fbStatus = fbStatus;
  this._github   = github;
  this._log      = log;

  // TODO(nevir): Configurable.
  this._reportUrl = 'http://polymerlabs.github.io/ci-runner/#' + commit.key;

  this._root;            // _createTempDir
  this._repo;            // _fetchRepo
  this._numPlatforms;    // _parseGruntLine
  this._numPassed = 0;   // _parseGruntLine
  this._numFailed = 0;   // _parseGruntLine
  this._lastStatus = {}; // _parseGruntLine
}

TestRunner.prototype.run = function run(done) {
  async.series([
    this._logEntry('info', 'Starting test run'),

    this._logEntry('group', 'Setup'),
    this.setCommitStatus.bind(this, 'pending', 'Starting'),
    this._createTempDir.bind(this),
    this.setCommitStatus.bind(this, 'pending', 'Fetching'),
    this._fetchRepo.bind(this),
    this._checkout.bind(this),
    this._npmInstall.bind(this),
    this._logEntry('groupEnd'),

    this._logEntry('group', 'Testing'),
    this.setCommitStatus.bind(this, 'pending', 'Spinning Up'),
    this._runGrunt.bind(this),
    this._logEntry('groupEnd'),

    this._logEntry('info', 'Test run complete'),

  ], function(error) {
    this._cleanup(function() {
      // TODO(nevir): Create comment for pushes.
      if (error) this._log.error(error);
      done(error);
    });
  }.bind(this));
};

TestRunner.prototype.setCommitStatus = function setCommitStatus(state, text, next) {
  this._log.info('Setting commit status to', chalk.yellow(state) + ':', chalk.blue(text));

  this._fbStatus.child('status').set({state: state, text: text});

  this._github.statuses.create({
    user:        this._commit.user,
    repo:        this._commit.repo,
    sha:         this._commit.sha,
    state:       state,
    description: text,
    target_url:  this._reportUrl,
  });

  // Let the statuses fly blind.
  if (next) next();
};

// Steps

TestRunner.prototype._createTempDir = function _createTempDir(next) {
  tmp.dir(function(err, path) {
    if (err) return next(err);
    this._log.info('Working within', path);
    this._root = path;
    next();
  }.bind(this));
};

// TODO(nevir): Cache bare repos and pull diffs from there.
TestRunner.prototype._fetchRepo = function _fetchRepo(next) {
  this._log.info('Cloning', this._commit.repoUrl);
  gift.clone(this._commit.repoUrl, this._root, function(error, repo) {
    this._repo = repo;
    next(error);
  }.bind(this));
};

TestRunner.prototype._checkout = function _checkout(next) {
  this._log.info('Checking out commit', chalk.yellow(this._commit.sha));
  this._repo.checkout(this._commit.sha, next);
};

// TODO(nevir): Cache npm packages.
TestRunner.prototype._npmInstall = function _npmInstall(next) {
  exec(this._log, 'npm', ['install'], this._root, next);
};

TestRunner.prototype._runGrunt = function _runGrunt(next) {
  exec(this._log, 'grunt', [], this._root, function(error) {
    next(error);
  }.bind(this), this._parseGruntLine.bind(this));
};

TestRunner.prototype._cleanup = function _cleanup(next) {
  shelljs.rm('-rf', this._root);
  next();
};

// Util

// TODO(nevir): This should go away eventually. Ideally, we are listening to a
// stream of events from the test runner (JSON stream over a socket?) for
// additional detail.
TestRunner.prototype._parseGruntLine = function _parseGruntLine(line) {
  var updateStatus;
  var match;
  if (match = line.match('(\\d+) tests started')) {
    updateStatus = true;
    this._numPlatforms = parseInt(match[1]);
    this._fbStatus.child('total').set(this._numPlatforms);
  }

  if (match = line.match('Platform: (.*)')) {
    this._lastStatus.platform = match[1];
  }

  if (match = line.match('Passed: (.*)')) {
    updateStatus = true;
    this._lastStatus.passed = (match[1] == 'true');
    if (this._lastStatus.passed) {
      this._numPassed++;
      this._fbStatus.child('passed').set(this._numPassed);
    } else {
      this._numFailed++;
      this._fbStatus.child('failed').set(this._numFailed);
    }
  }

  if (match = line.match('Url (.*)')) {
    this._lastStatus.url = match[1];
    // TODO(nevir):
    // var jobId = (match = this._lastStatus.url.match('jobs/(.*)')) && match[1];
    // var fbPlatformStatus = this._fbStatus.child('platforms').push(this._lastStatus);
    // updateWithLog(this._log, fbStatus, jobId);
  }

  if (updateStatus) {
    this._setTestStatus();
  }
}

TestRunner.prototype._setTestStatus = function _setTestStatus() {
  var message = this._numPlatforms + ' platforms: '
              + '✔' + this._numPassed + ', '
              + '✗' + this._numFailed;
  var status;
  if (this._numFailed > 0) {
    status = 'failed';
  } else if (this._numFailed + this._numPassed == this._numPlatforms) {
    status = 'success';
  } else {
    status = 'pending';
  }

  this.setCommitStatus(status, message);
};

TestRunner.prototype._logEntry = function _logEntry(kind) {
  var args = Array.prototype.slice.call(arguments, 1, arguments.length);
  return function(next) {
    this._log[kind].apply(this._log, args);
    next();
  }.bind(this);
};

module.exports = TestRunner;
