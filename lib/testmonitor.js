'use strict';

var _     = require('lodash');
var chalk = require('chalk');

var Browser = require('./browser');

// Listens to events from a test reporter and records them.
function TestMonitor(reporter, fbStatus, log) {
  this._reporter = reporter;
  this._fbStatus = fbStatus;
  this._log      = log;

  this._browsers = {};
  this._path     = [];
}

TestMonitor.listen = function listen(reporter, fbStatus, log) {
  var monitor = new this(reporter, fbStatus, log);
  monitor.listen();
  return monitor;
};

TestMonitor.prototype.listen = function listen() {
  this._reporter.on('log:debug',     this._onLog.bind(this, 'debug'));
  this._reporter.on('log:info',      this._onLog.bind(this, 'info'));
  this._reporter.on('log:warn',      this._onLog.bind(this, 'warn'));
  this._reporter.on('log:error',     this._onLog.bind(this, 'error'));

  this._reporter.on('run-start',     this._onRunStart.bind(this));
  this._reporter.on('browser-init',  this._onBrowserInit.bind(this));
  this._reporter.on('browser-start', this._onBrowserStart.bind(this));
  this._reporter.on('test-start',    this._onTestStart.bind(this));
  this._reporter.on('test-end',      this._onTestEnd.bind(this));
  this._reporter.on('browser-end',   this._onBrowserEnd.bind(this));
  this._reporter.on('run-end',       this._onRunEnd.bind(this));
};

// Test Runner Events

TestMonitor.prototype._onLog = function _onLog(level) {
  var args = _.rest(arguments, 1);
  if (args[0].browserName) {
    args[0] = this._getBrowser(args[0]);
  }

  this._log[level].apply(this._log, args);
};

TestMonitor.prototype._onRunStart = function _onRunStart(config) {
  this._log.info('Test run beginning with config:', JSON.stringify(config, null, 2));
};

TestMonitor.prototype._onBrowserInit = function _onBrowserInit(browserInfo) {
  this._log.info(this._getBrowser(browserInfo), 'initializing');
};

TestMonitor.prototype._onBrowserStart = function _onBrowserStart(browserInfo, info) {
  var browser = this._getBrowser(browserInfo);
  this._log.info(browser, 'spinning up session:', info);
  this._fbStatus.child('browsers').child(browserInfo.id).set(browser);
};

TestMonitor.prototype._onTestStart = function _onTestStart(browserInfo, data, stats) {
  var browser = this._getBrowser(browserInfo);
  this._log.info(browser, 'test starting:', data, 'stats:', stats);
};

TestMonitor.prototype._onTestEnd = function _onTestStart(browserInfo, data, stats) {
  var browser = this._getBrowser(browserInfo);
  this._log.info(browser, 'test ended:', data, 'stats:', stats);
};

TestMonitor.prototype._onBrowserEnd = function _onBrowserEnd(browserInfo, error, stats) {
  this._log.info(this._getBrowser(browserInfo), 'session complete:', error, stats);
};

TestMonitor.prototype._onRunEnd = function _onRunEnd(error) {
  this._log.info('Test run complete:', error);
};

// TestMonitor.prototype._onTestStatus = function _onTestStatus(payload) {
//   console.log(payload);
//   var browser = this._getBrowser(payload.browser);
//   var event   = payload.event;
//   var data    = payload.data;

//   // TODO(nevir): These are all mocha-centric; beware.
//   if (event === 'suite') {
//     if (data.title) {
//       this._path.push(data.title);
//     }

//   } else if (event === 'suite end') {
//     if (this._path[this._path.length - 1] === data.title) {
//       this._path.pop();
//     }

//   } else if (event === 'test') {
//     this._log.info(browser, 'Testing', this._title(data.title));

//   } else if (event === 'pending') {
//     this._log.warn(browser, 'Test pending', this._title(data.title));

//   } else if (event === 'pass') {
//     this._log.info(browser, chalk.green('Test passing'), this._title(data.title));

//   } else if (event === 'fail') {
//     this._log.error(browser, chalk.green('Test failure'), this._title(data.name), data.stack);
//   }
// };


// Util

TestMonitor.prototype._getBrowser = function _getBrowser(data) {
  if (!this._browsers[data.id]) {
    this._browsers[data.id] = new Browser(data);
  }
  return this._browsers[data.id];
};

TestMonitor.prototype._title = function _title(testTitle) {
  var title = chalk.cyan(testTitle);
  if (this._path.length > 0) {
    title = title + ' (' + this._path.join(' / ') + ')';
  }
  return title;
};

module.exports = TestMonitor;
