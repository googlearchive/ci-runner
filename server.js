'use strict';

var chalk      = require('chalk');
var express    = require('express');
var Firebase   = require('firebase');
var GHWebHooks = require('github-webhook-handler');
var GitHub     = require('github');
var os         = require('os');
var path       = require('path');

var Commit       = require('./lib/commit');
var Log          = require('./lib/log');
var protect      = require('./lib/protect');
var Queue        = require('./lib/queue');
var RepoRegistry = require('./lib/reporegistry');
var TestRunner   = require('./lib/testrunner');

// Available Configuration
//
// IF YOU ADD A CONFIGURATION VALUE, BE SURE TO ADD IT TO `tools/gcloud/manage`!

// Port to listen to HTTP traffic on.
var PORT = process.env.PORT || 3000;
// A unique identifier for this worker.
var WORKER_ID = process.env.WORKER_ID || os.hostname();
// Number of concurrent test runs.
var CONCURRENCY = parseInt(process.env.CONCURRENCY) || 10;
// Maximum delay in ms between transaction attempts. Minimum delay will be half
// of the maximum value.
var JITTER = process.env.JITTER || 250;
// Maximum number of milliseconds for an item to be claimed before it times out.
var ITEM_TIMEOUT = process.env.ITEM_TIMEOUT || 1800000; // 30 minutes.
// List of allowed test runners.
var VALID_RUNNERS = (process.env.VALID_RUNNERS || 'polymer-test-runner').split(',');

// OAuth token used when posting statuses/comments to GitHub.
// See https://github.com/settings/applications
var GITHUB_OAUTH_TOKEN = process.env.GITHUB_OAUTH_TOKEN;
// URL path to accept GitHub webhooks on.
var GITHUB_WEBHOOK_PATH = process.env.GITHUB_WEBHOOK_PATH || '/github';
// The secret registered for the webhook; invalid requests will be rejected.
var GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
// A whitelist of refs that pushes are accepted for.
var VALID_PUSH_BRANCHES = (process.env.VALID_PUSH_BRANCHES || 'master').split(',');

// Your Sauce Labs username.
var SAUCE_USERNAME = process.env.SAUCE_USERNAME;
// Your Sauce Labs access key.
var SAUCE_ACCESS_KEY = process.env.SAUCE_ACCESS_KEY;

// The Firebase URL where queue entries and run statuses are stored under.
var FIREBASE_ROOT = process.env.FIREBASE_ROOT;
// The Firebase secret used to generate an authentication token.
var FIREBASE_SECRET = process.env.FIREBASE_SECRET;

// Setup

// For the matter; we may not be in a real TTY.
chalk.enabled = true;

var fbRoot = new Firebase(FIREBASE_ROOT);
fbRoot.auth(FIREBASE_SECRET);

var github = new GitHub({version: '3.0.0'});
github.authenticate({type: 'oauth', token: GITHUB_OAUTH_TOKEN});

var repos = new RepoRegistry(path.join(__dirname, 'commits'));
var app   = express();
var queue = new Queue(processor, fbRoot.child('queue'), WORKER_ID, CONCURRENCY, JITTER, ITEM_TIMEOUT);
var hooks = new GHWebHooks({path: GITHUB_WEBHOOK_PATH, secret: GITHUB_WEBHOOK_SECRET});

// Commit Processor

function processor(commit, done) {
  // TODO(nevir): synchronize status output too!
  var fbStatus = fbRoot.child('status').child(commit.key);
  var log      = new Log(process.stdout, commit, fbStatus.child('log'));
  var runner   = new TestRunner(commit, fbStatus, github, repos, VALID_RUNNERS, log);
  protect(function() {
    runner.run(done);
  }, function(error) {
    log.fatal(error, 'CI runner internal error:');
    runner.setCommitStatus('error', 'Internal Error');
    done(error);
  });
}

// Web Server

console.log('server starting');

app.use(function(req, res, next){
  console.log('%s %s', req.method, req.url);
  next();
});

app.use(hooks);

app.get('/', function(req, res) {
  res.send('CI Runner: https://github.com/PolymerLabs/ci-runner');
});

hooks.on('push', function(event) {
  console.log('Received GitHub push event');

  var payload = event.payload;
  var commit;
  try {
    commit = Commit.forPushEvent(payload);
  } catch (error) {
    console.log('Malformed push event:', error, '\n', payload);
    return;
  }

  if (VALID_PUSH_BRANCHES.indexOf(commit.branch) === -1) {
    console.log('Push branch not in whitelist:', commit.branch);
  } else {
    queue.add(commit);
  }
});

hooks.on('pull_request', function(event) {
  console.log('Received GitHub pull_request event');

  var payload = event.payload;
  var commit;
  try {
    commit = Commit.forPullRequestEvent(payload);
  } catch (error) {
    console.log('Malformed push event:', error, '\n', payload);
    return;
  }
  queue.add(commit);
});

app.listen(PORT);

console.log('server listening for requests');
