'use strict';

var express        = require('express');
var Firebase       = require('firebase');
var GitHub         = require('github');
var os             = require('os');
var WebhookHandler = require('github-webhook-handler');

var Commit     = require('./lib/commit');
var Log        = require('./lib/log');
var protect    = require('./lib/protect');
var Queue      = require('./lib/queue');
var TestRunner = require('./lib/testrunner');

// Available Configuration

// A unique identifier for this worker.
var WORKER_ID = process.env.WORKER_ID || os.hostname();
// Number of concurrent test runs.
var CONCURRENCY = parseInt(process.env.CONCURRENCY) || 10;
// Maximum delay in ms between transaction attempts. Minimum delay will be half
// of the maximum value.
var JITTER = process.env.JITTER || 250;
// Maximum number of milliseconds for an item to be claimed before it times out.
var ITEM_TIMEOUT = process.env.ITEM_TIMEOUT || 1800000; // 30 minutes.

// OAuth token used when posting statuses/comments to GitHub.
// See https://github.com/settings/applications
var GITHUB_OAUTH_TOKEN = process.env.GITHUB_OAUTH_TOKEN;
// URL path to accept GitHub webhooks on.
var GITHUB_WEBHOOK_PATH = process.env.GITHUB_WEBHOOK_PATH || '/github';
// The secret registered for the webhook; invalid requests will be rejected.
var GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
// A whitelist of refs that pushes are accepted for.
var VALID_PUSH_REFS = (process.env.VALID_PUSH_REFS || 'refs/heads/master').split(' ');

// Your Sauce Labs username.
var SAUCE_USERNAME = process.env.SAUCE_USERNAME;
// Your Sauce Labs access key.
var SAUCE_ACCESS_KEY = process.env.SAUCE_ACCESS_KEY;

// The Firebase URL where queue entries and run statuses are stored under.
var FIREBASE_ROOT = process.env.FIREBASE_ROOT;

// Setup

var app    = express();
var fbRoot = new Firebase(FIREBASE_ROOT);
var queue  = new Queue(processor, fbRoot.child('queue'), WORKER_ID, CONCURRENCY, JITTER, ITEM_TIMEOUT);
var hooks  = new WebhookHandler({path: GITHUB_WEBHOOK_PATH, secret: GITHUB_WEBHOOK_SECRET});

var github = new GitHub({version: '3.0.0'});
github.authenticate({type: 'oauth', token: GITHUB_OAUTH_TOKEN});

// Commit Processor

function processor(commit, done) {
  // TODO(nevir): synchronize status output too!
  var fbStatus = fbRoot.child('status').child(commit.key);
  var log      = new Log(process.stdout, commit, fbStatus.child('log'));
  var runner   = new TestRunner(commit, fbStatus, github, log);
  protect(function() {
    runner.run(done);
  }, function(error) {
    log.fatal(error, 'CI runner internal error:');
    runner.setCommitStatus('error', 'Internal Error');
    done(error);
  });
}

// Web Server

app.get('/', function(req, res) {
  res.send('CI Runner: https://github.com/PolymerLabs/ci-runner');
});

app.use(hooks);
hooks.on('push', function(event) {
  var payload = event.payload
  if (VALID_PUSH_REFS.indexOf(payload.ref) === -1) {
    console.log('Push ref not in whitelist:', payload.ref);
    return;
  }

  var commit;
  try {
    commit = Commit.forPushEvent(payload);
  } catch (error) {
    console.log('Malformed push event:', error, '\n', payload);
    return;
  }
  queue.add(commit);
});

hooks.on('pull_request', function(event) {
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

app.listen(process.env.PORT || 3000);
