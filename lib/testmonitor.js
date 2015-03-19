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

var _          = require('lodash');
var chalk      = require('chalk');
var fs         = require('fs');
var handlebars = require('handlebars');
var path       = require('path');

var Browser = require('./browser');
var Test    = require('./test');
require('./handlebarsutils');

var FAILURE_TEMPLATE = handlebars.compile(
    fs.readFileSync(path.resolve(__dirname, '../data/run-failure.html'), {encoding: 'UTF-8'}));

// Number of milliseconds between browser status updates to mitigate GitHub API
// throttling.
var BROWSER_STATUS_DEBOUNCE = 10000;

// Listens to events from a test run (and eventually a reporter) and records them.
function TestMonitor(commit, fbStatus, mailer, github, log) {
  this._commit   = commit;
  this._fbStatus = fbStatus;
  this._mailer   = mailer;
  this._github   = github;
  this._log      = log;

  this._browsers = {};
  this._tests    = {};
  this._path     = [];
  this._failures = [];

  // TODO(nevir): Configurable.
  this._reportUrl = 'http://polymerlabs.github.io/ci-runner/#!/' + commit.key;
}

TestMonitor.prototype.listen = function listen(reporter) {
  this._reporter = reporter;

  this._reporter.on('run-start',     this._onRunStart.bind(this));
  this._reporter.on('browser-init',  this._onBrowserInit.bind(this));
  this._reporter.on('browser-start', this._onBrowserStart.bind(this));
  this._reporter.on('test-start',    this._onTestStart.bind(this));
  this._reporter.on('test-end',      this._onTestEnd.bind(this));
  this._reporter.on('browser-end',   this._onBrowserEnd.bind(this));
  this._reporter.on('run-end',       this._onRunEnd.bind(this));
};

TestMonitor.prototype.setCommitStatus = function setCommitStatus(scope, state, text, done) {
  this._github.statuses.create({
    user:        this._commit.user,
    repo:        this._commit.repo,
    sha:         this._commit.sha,
    state:       state,
    description: chalk.stripColor(text),
    context:     scope,
    target_url:  this._reportUrl,
  }, function(error) {
    if (error) {
      this._log.info('Error setting GH status:', error);
    }
    if (done) done();
  }.bind(this));
};

// Test Runner Events

TestMonitor.prototype._onRunStart = function _onRunStart(config) {
};

TestMonitor.prototype._onBrowserInit = function _onBrowserInit(browserInfo, stats) {
  var browser = this._getBrowser(browserInfo).update(stats);
  this._emitBrowserStatus(browser, true);
};

TestMonitor.prototype._onBrowserStart = function _onBrowserStart(browserInfo, data, stats) {
  this._getBrowser(browserInfo).update(stats);
};

TestMonitor.prototype._onTestStart = function _onTestStart(browserInfo, data, stats) {
  // Don't update the browser stats; too spammy.
  var browser = this._getBrowser(browserInfo);
  this._getTest(data.test).updateState(browser, 'running');
};

TestMonitor.prototype._onTestEnd = function _onTestEnd(browserInfo, data, stats) {
  var browser = this._getBrowser(browserInfo);
  browser.update(stats);
  var test = this._getTest(data.test);
  test.updateState(browser, data.state, data.error);

  if (data.error) {
    this._failures.push({browser: browser, test: test, error: data.error});
  }
  this._emitBrowserStatus(browser);
};

TestMonitor.prototype._onBrowserEnd = function _onBrowserEnd(browserInfo, error, stats) {
  var browser = this._getBrowser(browserInfo).update(stats, error);
  this._emitBrowserStatus(browser, true);
};

TestMonitor.prototype._onRunEnd = function _onRunEnd(error) {
  // TODO(nevir): Only email on state changes to the branch & commits to master?
  if (!error) return;

  var commit = this._commit;
  var commitUrl;
  if (commit.pullNum) {
    commitUrl = 'https://github.com/' + commit.user + '/' + commit.repo + '/pull/' + commit.pullNum;
  } else {
    commitUrl = 'https://github.com/' + commit.user + '/' + commit.repo + '/commit/' + commit.sha;
  }

  this._mailer.sendMail({
    to: commit.author,
    subject: '[' + commit.user + '/' + commit.repo + '] Failing Tests on ' + commit.shortSha,
    html: FAILURE_TEMPLATE({
      commit:        commit,
      reportUrl:     this._reportUrl,
      commitUrl:     commitUrl,
      firstFailure:  this._failures[0],
    }),
  });
};

// Util

TestMonitor.prototype._emitBrowserStatus = function _emitBrowserStatus(browser, force) {
  var stats  = browser.stats;
  var tokens = [];
  if (stats.failing > 0) { tokens.push(stats.failing + ' failing'); }
  if (stats.passing > 0) { tokens.push(stats.passing + ' passing'); }
  if (stats.pending > 0) { tokens.push(stats.pending + ' pending'); }
  var message = tokens.length > 0 ? tokens.join(', ') + ' tests' : '';

  if (browser.error) {
    message = message + '. error: ' + browser.error.substr(0, 50);
  }

  // Throttle updates to keep us well below the 5k/hr rate limit.
  if (!force) {
    var timestamp = Date.now();
    var previous  = browser._statusUpdatedAt;
    if (previous && (timestamp - previous) < BROWSER_STATUS_DEBOUNCE) {
      return;
    }
    browser._statusUpdatedAt = timestamp;
  }

  this.setCommitStatus(browser.inspect(), browser.githubStatus(), message);
}

TestMonitor.prototype._getBrowser = function _getBrowser(browserInfo) {
  if (!this._browsers[browserInfo.id]) {
    this._browsers[browserInfo.id] = new Browser(this._fbStatus.child('browsers'), browserInfo);
  }
  return this._browsers[browserInfo.id];
};

TestMonitor.prototype._getTest = function _getTest(name) {
  var identityKey = name.join('::');
  if (!this._tests[identityKey]) {
    this._tests[identityKey] = new Test(this._fbStatus.child('tests'), name);
  }
  return this._tests[identityKey];
};

module.exports = TestMonitor;
