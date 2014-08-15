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
  this.key      = user + '/' + repo + '/' + sha;
}

Commit.prototype.inspect = function() {
  return chalk.cyan(this.user + '/' + this.repo) + '#' + chalk.yellow(this.sha.substr(0, 8));
}

Commit.forPushEvent = function forPushEvent(event) {
  var repo = event.repository;
  return new Commit(repo.owner.name, repo.name, event.head_commit.id);
};

Commit.forPullRequestEvent = function forPullRequestEvent(event) {
  var head = event.pull_request.head;
  return new Commit(head.user.login, head.repo.name, head.sha);
};

module.exports = Commit;
