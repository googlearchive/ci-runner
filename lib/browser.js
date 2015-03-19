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

var _ = require('lodash');

function Browser(fbBrowsers, info) {
  this._fbBrowsers = fbBrowsers;
  this._info       = info;

  this.id     = info.id;
  this.status = 'unknown';
  this.stats  = {};
}

Browser.prototype.update = function update(stats, error) {
  this.stats  = _.clone(stats);
  this.status = this.stats.status;
  delete this.stats.status;
  this.setError(error);

  this.save();
  return this;
};

Browser.prototype.setError = function setError(error) {
  if (!error) return;
  if (error[0] === '{') {
    try {
      error = JSON.parse(error);
    } catch (_) {
      // *shrug*
    }
  }

  this.error = (error.value && error.value.message) || error.message || error;
};

Browser.prototype.save = function save() {
  var values = {
    name:     this._info.browserName,
    device:   this._info.deviceName,
    version:  this._info.version,
    platform: this._info.platform,
    status:   this.status,
    stats:    this.stats,
    error:    this.error,
  };
  // Firebase is ornery.
  _.each(values, function(value, key) {
    if (_.isUndefined(value)) {
      delete values[key];
    }
  });

  this._fbBrowsers.child(this._info.id).set(values);
};

Browser.prototype.githubStatus = function() {
  if (this.status !== 'complete') return 'pending';
  if (this.error) return 'failure';  // Almost always user error.
  if (this.stats.failing > 0) return 'failure';
  return 'success';
};

Browser.prototype.inspect = function() {
  var name     = this._info.deviceName || this._info.browserName;
  var version  = this._info.version;
  var platform = this._info.platform ? ' (' + this._info.platform + ')' : '';
  return name + ' ' + version + platform;
};

module.exports = Browser;
