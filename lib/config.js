'use strict';

var _  = require('underscore');
var os = require('os');

// Accepts environment variables and converts them into a handy config object.
function Config(env) {
  // IF YOU ADD A CONFIGURATION VALUE, BE SURE TO ADD IT TO `tools/gcloud/manage`!

  // Worker configuration.
  this.worker = {
    // Port to listen to HTTP traffic on.
    port: env.PORT || 3000,
    // A unique identifier for this worker.
    workerId: env.WORKER_ID || os.hostname(),
    // Number of concurrent test runs.
    concurrency: parseInt(env.CONCURRENCY) || 10,
    // Maximum delay in ms between transaction attempts. Minimum delay will be half
    // of the maximum value.
    jitter: env.JITTER || 250,
    // Maximum number of milliseconds for an item to be claimed before it times out.
    itemTimeout: env.ITEM_TIMEOUT || 1800000, // 30 minutes.
    // List of allowed test runners.
    validRunners: (env.VALID_RUNNERS || 'web-component-tester').split(','),
  };

  this.github = {
    // OAuth token used when posting statuses/comments to GitHub.
    // See https://github.com/settings/applications
    oauthToken: env.GITHUB_OAUTH_TOKEN,
    // URL path to accept GitHub webhooks on.
    webhookPath: env.GITHUB_WEBHOOK_PATH || '/github',
    // The secret registered for the webhook; invalid requests will be rejected.
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
    // A whitelist of refs that pushes are accepted for.
    validPushBranches: (env.VALID_PUSH_BRANCHES || 'master').split(','),
  };

  this.sauce = {
    // Your Sauce Labs username.
    username: env.SAUCE_USERNAME,
    // Your Sauce Labs access key.
    accessKey: env.SAUCE_ACCESS_KEY,
  };

  this.firebase = {
    // The Firebase URL where queue entries and run statuses are stored under.
    root: env.FIREBASE_ROOT,
    // The Firebase secret used to generate an authentication token.
    secret: env.FIREBASE_SECRET,
  };
};

module.exports = Config;
