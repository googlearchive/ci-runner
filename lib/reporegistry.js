'use strict';

var async   = require('async');
var chalk   = require('chalk');
var fs      = require('fs');
var Git     = require('git-wrapper');
var mkdirp  = require('mkdirp');
var path    = require('path');
var synchro = require('synchronized');

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

    var git = new Git({cwd: mirror});
    async.series([

      mkdirp.bind(null, mirror),

      function(stepDone) {
        git.exec('clone', {mirror: true}, [commit.repoUrl, '.'], function() {
          stepDone(); // Ignore errors; assume that means it's already there.
        });
      },

      git.exec.bind(git, 'fetch', ['origin']),

    ], done);
  }, next);
};

RepoRegistry.prototype._fetchCopy = function _fetchCopy(commit, dest, mirror, log, next) {
  log.info('Checking out commit', chalk.yellow(commit.sha));

  var git = new Git({cwd: dest});
  async.series([
    mkdirp.bind(null, dest),
    git.exec.bind(git, 'clone', {reference: mirror}, [commit.repoUrl, '.']),
    git.exec.bind(git, 'checkout', [commit.sha]),
  ], next);
};

// Utility

RepoRegistry.prototype._pathPart = function _pathPart(commit) {
  return commit.repoUrl.replace(/[^a-z0-9]/ig, '-');
};

module.exports = RepoRegistry;
