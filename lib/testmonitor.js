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

var _      = require('lodash');
var chalk  = require('chalk');
var events = require('events');

var Browser = require('./browser');
var Test    = require('./test');

// Listens to events from a test reporter and records them.
function TestMonitor(reporter, fbStatus, log) {
  this._reporter = reporter;
  this._fbStatus = fbStatus;
  this._log      = log;

  this._browsers = {};
  this._tests    = {};
  this._path     = [];
}
TestMonitor.prototype = Object.create(events.EventEmitter.prototype);

TestMonitor.listen = function listen(reporter, fbStatus, log) {
  var monitor = new this(reporter, fbStatus, log);
  monitor.listen();
  return monitor;
};

TestMonitor.prototype.listen = function listen() {
  this._reporter.on('run-start',     this._onRunStart.bind(this));
  this._reporter.on('browser-init',  this._onBrowserInit.bind(this));
  this._reporter.on('browser-start', this._onBrowserStart.bind(this));
  this._reporter.on('test-start',    this._onTestStart.bind(this));
  this._reporter.on('test-end',      this._onTestEnd.bind(this));
  this._reporter.on('browser-end',   this._onBrowserEnd.bind(this));
  this._reporter.on('run-end',       this._onRunEnd.bind(this));
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

  var status;
  if (failing > 0) {
    status = ['failure', failing + ' of ' + keys.length + ' browsers failing'];
    return;
  } else {
    status = ['pending', complete + ' of ' + keys.length + ' browsers complete'];
  }
  this.emit('short-status', status);
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
