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
