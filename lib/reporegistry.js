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

var async   = require('async');
var chalk   = require('chalk');
var fs      = require('fs');
var mkdirp  = require('mkdirp');
var path    = require('path');
var synchro = require('synchronized');

var exec = require('./exec');

function RepoRegistry(root) {
  this._root = root;
}

RepoRegistry.prototype.clone = function clone(commit, dest, log, done) {
  var mirror = path.join(this._root, this._pathPart(commit));
  async.series([
    this._syncMirror.bind(this, commit, dest, mirror, log),
    this._fetchCopy.bind(this, commit, dest, mirror, log),
  ], done);
};

RepoRegistry.prototype._syncMirror = function _syncMirror(commit, dest, mirror, log, next) {
  synchro(commit.repoUrl, function(done) {
    log.info('Fetching', chalk.cyan(commit.repoUrl));

    async.series([

      mkdirp.bind(null, mirror),

      function(stepDone) {
        exec(log, 'git', ['clone', '--mirror', commit.repoUrl, '.'], mirror, function() {
          stepDone(); // Ignore errors; assume that means it's already there.
        });
      },

      exec.bind(null, log, 'git', ['fetch', 'origin'], mirror),

    ], done);
  }, next);
};

RepoRegistry.prototype._fetchCopy = function _fetchCopy(commit, dest, mirror, log, next) {
  log.info('Checking out commit', chalk.yellow(commit.sha));

  async.series([
    mkdirp.bind(null, dest),
    exec.bind(null, log, 'git', ['clone', '--reference', mirror, commit.repoUrl, '.'], dest),
    exec.bind(null, log, 'git', ['checkout', commit.sha], dest),
  ], next);
};

// Utility

RepoRegistry.prototype._pathPart = function _pathPart(commit) {
  return commit.repoUrl.replace(/[^a-z0-9]/ig, '-');
};

module.exports = RepoRegistry;
