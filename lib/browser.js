'use strict';

var chalk = require('chalk');

function Browser(info) {
  if (!info.browserName) {
    throw new Error('at least browserName is required');
  }

  this.name     = info.browserName;
  this.version  = info.version;
  this.platform = info.platform;
}

Browser.prototype.inspect = function inspect() {
  var parts = [];
  if (this.platform) {
    parts.push(this.platform);
  }
  parts.push(this.name);
  if (this.version) {
    parts.push(chalk.yellow(this.version));
  }

  return chalk.magenta('[' + parts.join(' ') + ']');
};

module.exports = Browser;
