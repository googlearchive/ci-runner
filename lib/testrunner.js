'use strict';

var _         = require('underscore');
var async     = require('async');
var BowerJson = require('bower-json');
var chalk     = require('chalk');
var fs        = require('fs');
var github    = require('github');
var mkdirp    = require('mkdirp');
var path      = require('path');
var shelljs   = require('shelljs');
var tmp       = require('tmp');
var util      = require('util');

var Browser = require('./browser');
var exec    = require('./exec');

var TEST_CONFIG = 'tests/tests.json';

function TestRunner(commit, fbStatus, github, repos, config, log) {
  this._commit   = commit;
  this._fbStatus = fbStatus;
  this._github   = github;
  this._repos    = repos;
  this._config   = config;
  this._log      = log;

  // TODO(nevir): Configurable.
  this._reportUrl = 'http://polymerlabs.github.io/ci-runner/#' + commit.key;

  this._sandbox;  // _makeSandbox
  this._root;     // _fetchRepo (temporary), _makeBowerSandbox (final).
  this._metadata; // _evalMetadata
}

TestRunner.prototype.run = function run(done) {
  async.series([
    this._logEntry('info', 'Starting test run'),

    this._logEntry('group', 'Setup'),
    this.setCommitStatus.bind(this, 'pending', 'Cloning'),
    this._makeSandbox.bind(this),
    this._fetchRepo.bind(this),
    this._evalMetadata.bind(this),
    this.setCommitStatus.bind(this, 'pending', 'Fetching Dependencies'),
    this._makeBowerSandbox.bind(this),
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
      } else {
        this.setCommitStatus('success', 'tests passed');
      }
      done(error);
    }.bind(this));
  }.bind(this));
};

TestRunner.prototype.setCommitStatus = function setCommitStatus(state, text, next) {
  var prevState = this._commitStatus && this._commitStatus.state;

  // Don't bash over failure statuses.
  if (state == 'success' && prevState && prevState != 'success' && prevState != 'pending') {
    return next();
  }
  // Pending shouldn't bash over any other state
  if (state == 'pending' && prevState && prevState != 'pending') {
    state = prevState;
  }

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

TestRunner.prototype._makeSandbox = function _makeSandbox(next) {
  tmp.dir({keep: true}, function(error, path) {
    if (error) return next(error);
    this._log.info('Working within sandbox:', path);
    this._sandbox = path;
    next();
  }.bind(this));
};

TestRunner.prototype._fetchRepo = function _fetchRepo(next) {
  this._root = path.join(this._sandbox, '_repo');
  this._repos.clone(this._commit, this._root, this._log, next);
};

TestRunner.prototype._evalMetadata = function _evalMetadata(next) {
  this._log.info('Validating', TEST_CONFIG);
  var metadataPath = path.join(this._root, TEST_CONFIG);
  fs.readFile(metadataPath, function(error, data) {
    if (error) return next(['Missing ' + TEST_CONFIG + ' in package root', error]);

    try {
      this._metadata = JSON.parse(data);
    } catch (error) {
      return next(['Failed to parse ' + TEST_CONFIG, error]);
    }

    this._runnerName = this._metadata.runner;
    if (!_.contains(this._config.worker.validRunners, this._runnerName)) {
      return next(['Invalid ' + TEST_CONFIG, 'Test runner "' + this._runnerName + "' not whitelisted."]);
    }
    next();
  }.bind(this));
};

TestRunner.prototype._makeBowerSandbox = function _makeBowerSandbox(next) {
  BowerJson.read(path.join(this._root, 'bower.json'), function(error, info) {
    if (error) return next(['Invalid bower.json', error]);
    if (!(typeof info.name === 'string')) return next('package name is required');

    // Make sure the name doesn't break out of our sandbox
    var packageRoot = path.resolve(this._sandbox, info.name)
    if (packageRoot.indexOf(this._sandbox) !== 0) {
      return next('Inavlid package name: ' + info.name);
    }

    shelljs.mv(this._root, packageRoot);
    this._root = packageRoot;
    next();
  }.bind(this));
};

TestRunner.prototype._bowerInstall = function _bowerInstall(next) {
  // Enforce that dependencies are siblings
  var rc = '{"directory": "../"}';
  fs.writeFile(path.join(this._root, '.bowerrc'), rc, function(error) {
    if (error) return next(error);
    // Just less to deal with when we're shelling out.
    exec(this._log, 'bower', ['install'], this._root, next);
  }.bind(this));
};

TestRunner.prototype._runTests = function _runTests(next) {
  this._log.group('Executing test runner', chalk.green(this._runnerName));
  var runner = require(this._runnerName).test;
  // TODO(nevir): This test interface should be more portable.
  var browsers = this._metadata.browsers || [
    {browserName: 'chrome', version: '35', platform: 'Windows'},
  ];
  var options = {
    root:      this._sandbox,
    component: path.basename(this._root),
  };
  var reporter = runner(false, browsers, options, function(error) {
    this._log.groupEnd();
    next(error);
  }.bind(this));

  this._monitor(reporter);
};

TestRunner.prototype._monitor = function _monitor(reporter) {
  reporter.on('log', this._log.info.bind(this._log));

  this._browsers = {};

  reporter.on('run-start', function(config) {
    this._log.info('Test run beginning with config:', JSON.stringify(config, null, 2));
  }.bind(this));

  reporter.on('browser-start', function(config) {
    this._log.info('Browser spinning up session with config:', JSON.stringify(config, null, 2));
    this._browsers[config.browser.id] = new Browser(config.browser);
  }.bind(this));

  reporter.on('test-status', function(payload) {
    // TODO(nevir): Do this in the tester.
    var data;
    try {
      data = JSON.parse(payload.data);
    } catch (error) {
      this._log.warn(
          'Test event', chalk.yellow(payload.event),
          'with corrupt payload', util.inspect(payload));
      return;
    }
    var browser = this._browsers[payload.browser];
    this._log.info(browser, 'Test event', chalk.yellow(payload.event), JSON.stringify(data, null, 2))
  }.bind(this));

  reporter.on('browser-end', function(config) {
    this._log.info('Browser session complete:', JSON.stringify(config, null, 2));
  }.bind(this));

  reporter.on('run-end', function(results) {
    this._log.info('Test run complete. Raw results:', JSON.stringify(results, null, 2));
  }.bind(this));
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
