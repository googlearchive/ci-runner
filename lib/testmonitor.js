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

var FAILURE_TEMPLATE = handlebars.compile(
    fs.readFileSync(path.resolve(__dirname, '../data/run-failure.html'), {encoding: 'UTF-8'}));

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

TestMonitor.prototype.setCommitStatus = function setCommitStatus(state, text, done) {
  var prevState = this._commitStatus && this._commitStatus.state;

  // Don't bash over failure statuses.
  if (state == 'success' && prevState && prevState != 'success' && prevState != 'pending') {
    return done();
  }
  // Pending shouldn't bash over any other state
  if (state == 'pending' && prevState && prevState != 'pending') {
    state = prevState;
  }

  this._log.info('Setting commit status to', chalk.yellow(state) + ':', chalk.blue(text));
  this._commitStatus = {state: state, text: chalk.stripColor(text)};

  this._fbStatus.child('status').set(this._commitStatus);

  this._github.statuses.create({
    user:        this._commit.user,
    repo:        this._commit.repo,
    sha:         this._commit.sha,
    state:       state,
    description: text,
    target_url:  this._reportUrl,
  }, done);
};

// Test Runner Events

TestMonitor.prototype._onRunStart = function _onRunStart(config) {
};

TestMonitor.prototype._onBrowserInit = function _onBrowserInit(browserInfo, stats) {
  this._getBrowser(browserInfo).update(stats);
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
  var browser    = this._getBrowser(browserInfo);
  var emitStatus = stats.failing > 0 && browser.stats.failing === 0;
  browser.update(stats);
  this._getTest(data.test).updateState(browser, data.state, data.error);

  if (emitStatus) this._emitShortStatus();
};

TestMonitor.prototype._onBrowserEnd = function _onBrowserEnd(browserInfo, error, stats) {
  this._getBrowser(browserInfo).update(stats);
  this._emitShortStatus();
};

TestMonitor.prototype._onRunEnd = function _onRunEnd(error) {
  // TODO(nevir): Only email on state changes to the branch & commits to master?
  if (!error) return;

  this._mailer.sendMail({
    to: this._commit.author,
    subject: '[' + this._commit.user + '/' + this._commit.repo + '] Failing Tests',
    html: FAILURE_TEMPLATE({
      commit:    this._commit,
      browsers:  this._browsers,
      reportUrl: this._reportUrl,
    }),
  });
};

// Util

TestMonitor.prototype._emitShortStatus = function _emitShortStatus() {
  var failing = 0;
  var complete = 0;
  var keys = Object.keys(this._browsers);
  for (var i = 0, key; key = keys[i]; i++) {
    if (this._browsers[key].stats.failing > 0) {
      failing = failing + 1;
    }
    if (this._browsers[key].status === 'complete') {
      complete = complete + 1;
    }
  }

  if (failing > 0) {
    this.setCommitStatus('failure', failing  + ' of ' + keys.length + ' browsers failing');
  } else {
    this.setCommitStatus('pending', complete + ' of ' + keys.length + ' browsers complete');
  }
};

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
