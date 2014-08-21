'use strict';

var _       = require('underscore');
var chalk   = require('chalk');
var sprintf = require('sprintf-js').sprintf;
var util    = require('util');

var STYLES = {
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

  fbRef.remove();
  fbRef.start = 0.0; // For duration annotations.
}

// Specific Events

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
  var prefix = sprintf('%s %7.3fs: %s', this.commit.inspect(), delta, indent);
  this.stream.write(chalk.dim(prefix) + STYLES[style](line) + '\n');

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
