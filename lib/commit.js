'use strict';

var chalk = require('chalk');
var util  = require('util');

// Simple representation of a GitHub ref.
function Commit(user, repo, sha) {
  if (!user || !repo || !sha) {
    throw new Error('Commit is missing values; got: ' + util.inspect(arguments));
  }
  this.user = user;
  this.repo = repo;
  this.sha  = sha;

  this.repoUrl  = 'https://github.com/' + user + '/' + repo;
  this.key      = user + '|' + repo + '|' + sha;
  this.pathPart = user + '-' + repo + '-' + sha;
}

Commit.prototype.inspect = function() {
  return chalk.cyan(this.user + '/' + this.repo) + '#' + chalk.yellow(this.sha.substr(0, 8));
}

module.exports = Commit;
