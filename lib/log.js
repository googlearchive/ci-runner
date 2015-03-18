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

var _       = require('lodash');
var chalk   = require('chalk');
var sprintf = require('sprintf-js').sprintf;
var util    = require('util');

var STYLES = {
  debug: chalk.dim,
  info:  function(value) { return value; },
  group: chalk.underline,
  warn:  chalk.yellow,
  error: chalk.red,
}

// Tracks events occurring during a test run.
//
// Emits events to stdout as well as to firebase.
function Log(stream, commit, fbRef) {
  this.stream   = stream;
  this.commit   = commit;
  this.refStack = [fbRef]; // Top is most specific.
  this.start    = new Date().getTime();

  this._captured = null;

  fbRef.start = 0.0; // For duration annotations.
  fbRef.set({});
}

// Specific Events

Log.prototype.debug = function debug() {
  this._writeLine('debug', arguments);
};

Log.prototype.info = function info() {
  this._writeLine('info', arguments);
};

Log.prototype.group = function group() {
  var newRef   = this._writeLine('group', arguments).child('children');
  newRef.start = this._getDelta();
  this.refStack.unshift(newRef);
};

Log.prototype.groupEnd = function groupEnd() {
  this._writeLine('info', [], true);
  var oldRef = this.refStack.shift();
  oldRef.parent().child('duration').set(this._getDelta() - oldRef.start);
};

Log.prototype.warn = function warn() {
  this._writeLine('warn', arguments);
};

Log.prototype.error = function error() {
  this._writeLine('error', arguments);
};

Log.prototype.fatal = function fatal(error) {
  var args = Array.prototype.slice.call(arguments, 1)
  args = args.concat([error.stack]);
  this._writeLine('error', args);
};

// Capturing

Log.prototype.capture = function() {
  this._captured = [];
};

Log.prototype.captureEnd = function() {
  return this._captured;
  this._captured = null;
};

// Utility

// Formats and writes any extra arguments to the console and firebase ref.
Log.prototype._writeLine = function _writeLine(style, args, noPush) {
  var delta = this._getDelta();
  var line  = this._formatLine(args);

  // TODO(nevir): May want a more compact representation.
  var newRef;
  if (!noPush) {
    newRef = this.refStack[0].push({delta: delta, line: line, style: style});
  }

  var indent = Array(this.refStack.length).join('  ');
  var prefix = '';
  if (this.commit) {
    prefix = sprintf('%s %7.3fs: ', this.commit.inspect(), delta);
  }
  var fullLine = chalk.dim(prefix) + indent + STYLES[style](line);
  this.stream.write(fullLine + '\n');
  if (this._captured) {
    this._captured.push(fullLine);
  }

  return newRef;
};

Log.prototype._formatLine = function _formatLine(args) {
  return _.map(args, function(arg) {
    if (typeof arg === 'string') {
      return arg;
    } else {
      return util.inspect(arg);
    }
  }).join(' ');
};

Log.prototype._getDelta = function _getDelta() {
  return (new Date().getTime() - this.start) / 1000;
};

module.exports = Log;
