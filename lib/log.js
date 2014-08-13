'use strict';

var chalk   = require('chalk');
var sprintf = require('sprintf-js').sprintf;
var util    = require('util');

var STYLES = {
  info:  function(value) { return value; },
  group: chalk.underline,
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

  fbRef.start = 0.0; // For duration annotations.
}

// Formats and writes any extra arguments to the console and firebase ref.
Log.prototype.writeLine = function writeLine(style, data, noPush) {
  var delta = this.getDelta();
  // TODO(nevir): May want a more compact representation.
  var newRef;
  if (!noPush) {
    newRef = this.refStack[0].push({delta: delta, data: data, style: style});
  }

  var indent = Array(this.refStack.length).join('  ');
  var prefix = sprintf('%s %7.3fs: %s', this.commit.inspect(), delta, indent);
  var line   = util.format.apply(util, data);
  this.stream.write(chalk.dim(prefix) + STYLES[style](line) + '\n');

  return newRef;
}

Log.prototype.getDelta = function getDelta() {
  return (new Date().getTime() - this.start) / 1000;
}

// Specific Events

Log.prototype.info = function info() {
  this.writeLine('info', arguments);
};

Log.prototype.group = function group() {
  var newRef   = this.writeLine('group', arguments).child('children');
  newRef.start = this.getDelta();
  this.refStack.unshift(newRef);
};

Log.prototype.groupEnd = function groupEnd() {
  this.writeLine('info', [], true);

  var oldRef = this.refStack.shift();
  oldRef.parent().child('duration').set(this.getDelta() - oldRef.start);
}

Log.prototype.error = function error() {
  this.writeLine('error', arguments);
}

module.exports = Log;
