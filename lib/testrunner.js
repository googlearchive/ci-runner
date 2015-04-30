/*
 * @license
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */
'use strict';

var _           = require('lodash');
var async       = require('async');
var BowerJson   = require('bower-json');
var chalk       = require('chalk');
var escapeHtml  = require('escape-html');
var fs          = require('fs');
var gift        = require('gift');
var github      = require('github');
var handlebars  = require('handlebars');
var LinerStream = require('linerstream');
var mkdirp      = require('mkdirp');
var path        = require('path');
var shelljs     = require('shelljs');
var tmp         = require('tmp');
var util        = require('util');

var exec        = require('./exec');
var TestMonitor = require('./testmonitor');

// TODO(nevir): Make configurable (via bower.json or package.json)
var TEST_RUNNER  = 'web-component-tester';
var PACKAGE_ROOT = path.resolve(__dirname, '..');

var RUNNER_INSTALL_FAILURE_TEMPLATE = handlebars.compile(
    fs.readFileSync(path.resolve(__dirname, '../data/runner-install-failure.html'), {encoding: 'UTF-8'}));

// Manages the workflow required to run tests.
//
// Also see TestMonitor for the output management once a test begins.
function TestRunner(commit, fbStatus, github, repos, config, mailer, log) {
  this._commit = commit;
  this._repos  = repos;
  this._config = config;
  this._log    = log;

  // Clean slate each time
  fbStatus.remove();
  this._monitor = new TestMonitor(this._commit, fbStatus, mailer, github, this._log);

  this._sandbox;  // _makeSandbox
  this._root;     // _fetchRepo (temporary), _makeBowerSandbox (final).
  this._metadata; // _evalMetadata
}

// Runner Installation

TestRunner.update = function update(config, workerLog, mailer, done) {
  workerLog.capture();

  exec(workerLog, 'npm', ['install', TEST_RUNNER], PACKAGE_ROOT, function(error) {
    var lines = workerLog.captureEnd();
    if (error) {
      var command    = 'npm install ' + TEST_RUNNER;
      var installLog = lines.map(escapeHtml).join('\n');
      mailer.sendMail({
        to: config.email.recipients,
        subject: 'Runner Failure: ' + command,
        html: RUNNER_INSTALL_FAILURE_TEMPLATE({
          runner:  TEST_RUNNER,
          command: command,
          log:     installLog,
        }),
      });
    } else {
      workerLog.info('Installed/updated', TEST_RUNNER);
    }

    done(error);
  });
};

// Actual Test Running

TestRunner.prototype.run = function run(done) {
  async.series([
    this._logEntry('info', 'Starting test run'),

    this._logEntry('group', 'Setup'),
    this._makeSandbox.bind(this),
    this._fetchRepo.bind(this),
    this._readCommitDetails.bind(this),
    this._makeBowerSandbox.bind(this),
    this._bowerInstall.bind(this),
    this._logEntry('groupEnd'),

    this._logEntry('group', 'Testing'),
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

// TODO(nevir): Move this into TestMonitor.


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

TestRunner.prototype._readCommitDetails = function _readCommitDetails(next) {
  var git = gift(this._root);
  git.current_commit(function(error, commit) {
    if (error) return next(error);

    this._commit.author  = commit.committer || commit.author;
    this._commit.message = commit.message;

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
  // Enforce that dependencies are in the normal layout.
  var rc = '{"directory": "bower_components/"}';
  fs.writeFile(path.join(this._root, '.bowerrc'), rc, function(error) {
    if (error) return next(error);
    // Just less to deal with when we're shelling out.
    exec(this._log, 'bower', ['install', '--allow-root'], this._root, next);
  }.bind(this));
};

TestRunner.prototype._runTests = function _runTests(next) {
  this._log.group('Executing test runner', chalk.green(TEST_RUNNER));
  var runner = require(TEST_RUNNER).test;
  var output = new LinerStream();
  output.on('data', this._log.info.bind(this._log));

  var options = {
    root: this._root,
    output: output,
    enforceJsonConf: true,
    browserOptions: {
      name: this._commit.short(),
      build: this._commit.sha,
      tags: [
        'org:' + this._commit.user,
        'repo:' + this._commit.repo,
        'branch:' + this._commit.branch || '<unknown>',
      ],
    },
    plugins: {
      local: {
        disabled: true,
      },
      sauce: {
        browsers:  ['default'],
        username:  this._config.sauce.username,
        accessKey: this._config.sauce.accessKey,
        tunnelId:  this._config.sauce.tunnelIdentifier,
      },
    },
  };

  var reporter = runner(options, function(error) {
    this._log.groupEnd();
    next(error ? ['failure', error] : null);
  }.bind(this));

  this._monitor.listen(reporter);
};

// Util

TestRunner.prototype._cleanup = function _cleanup(next) {
  if (this._root) shelljs.rm('-rf', this._root);
  next();
};

TestRunner.prototype._emitFailure = function _emitFailure(failure) {
  var status, failure;
  if (Array.isArray(failure)) {
    status  = failure[0];
    failure = failure[1];
  }
  status  = status  || 'error';
  failure = failure || 'Test run did not complete';
  if (failure.message) failure = failure.message;
  this._log.error(failure);
};

TestRunner.prototype._logEntry = function _logEntry(kind) {
  var args = Array.prototype.slice.call(arguments, 1, arguments.length);
  return function(next) {
    this._log[kind].apply(this._log, args);
    next();
  }.bind(this);
};

module.exports = TestRunner;
