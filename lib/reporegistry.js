'use strict';

var async   = require('async');
var chalk   = require('chalk');
var fs      = require('fs');
var Git     = require('git-wrapper');
var mkdirp  = require('mkdirp');
var path    = require('path');
var synchro = require('synchronized');
var tmp     = require('tmp');

function RepoRegistry(root) {
  this._root = root;
}

RepoRegistry.prototype.clone = function clone(commit, log, done) {
  var mirror = path.join(this._root, this._pathPart(commit));
  async.waterfall([
    this._syncMirror.bind(this, commit, mirror, log),
    this._makeTempDir.bind(this, commit, mirror, log),
    this._fetchCopy.bind(this, commit, mirror, log),
  ], done);
};

RepoRegistry.prototype._syncMirror = function _syncMirror(commit, mirror, log, next) {
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
  }, function(error) {
    next(error);
  });
};

RepoRegistry.prototype._makeTempDir = function _makeTempDir(commit, mirror, log, next) {
  tmp.dir({keep: true}, function(error, path) {
    if (!error) {
      log.info('Working within sandbox:', path);
    }
    next(error, path);
  });
};

RepoRegistry.prototype._fetchCopy = function _fetchCopy(commit, mirror, log, path, next) {
  var git = new Git({cwd: path});
  async.series([

    git.exec.bind(git, 'clone', {reference: mirror}, [commit.repoUrl, '.']),

    function(stepDone) {
      log.info('Checking out commit', chalk.yellow(commit.sha));
      stepDone();
    },

    git.exec.bind(git, 'checkout', [commit.sha]),

  ], function(error) {
    next(error, path);
  });
};

// Utility

RepoRegistry.prototype._pathPart = function _pathPart(commit) {
  return commit.repoUrl.replace(/[^a-z0-9]/ig, '-');
};

module.exports = RepoRegistry;
