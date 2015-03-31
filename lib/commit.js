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
var util  = require('util');

// Simple representation of a GitHub ref.
function Commit(user, repo, sha, branch, pullNum) {
  if (!user || !repo || !sha || !branch) {
    throw new Error('Commit is missing values; got: ' + util.inspect(arguments));
  }
  this.user    = user;
  this.repo    = repo;
  this.sha     = sha;
  this.branch  = branch;
  this.pullNum = pullNum;

  this.shortSha = this.sha.substr(0, 8);

  this.repoUrl  = 'https://github.com/' + user + '/' + repo;
  this.key      = user + '/' + repo + '/' + sha;
}

// Convert an object that looks like a commit to one for real.
Commit.from = function from(item) {
  var commit = new Commit(item.user, item.repo, item.sha, item.branch, item.pullNum);
  if (item.forkOf) {
    commit.forkOf = {
      user: item.forkOf.user,
      repo: item.forkOf.repo,
    };
  }
  return commit;
};

Commit.prototype.inspect = function inspect() {
  return chalk.cyan(this.user + '/' + this.repo) + '@' + chalk.yellow(this.shortSha);
};

Commit.prototype.short = function short() {
  return this.user + '/' + this.repo + '@' + this.shortSha;
};

// https://developer.github.com/v3/activity/events/types/#pushevent
Commit.forPushEvent = function forPushEvent(event) {
  var branch = event.ref.match(/^refs\/heads\/(.+)$/)[1];
  var repo   = event.repository;
  return new Commit(repo.owner.name, repo.name, event.head_commit.id, branch);
};

// https://developer.github.com/v3/activity/events/types/#pullrequestevent
Commit.forPullRequestEvent = function forPullRequestEvent(event) {
  var head = event.pull_request.head;
  var repo = event.pull_request.repo;
  var commit = new Commit(head.user.login, head.repo.name, head.sha, head.ref, event.pull_request.number);
  if (repo && repo.owner && repo.owner.login !== head.user.login || repo.name !== head.repo.name) {
    commit.forkOf = {
      user: repo.owner.login,
      repo: repo.name,
    };
  }
  return commit;
};

module.exports = Commit;
