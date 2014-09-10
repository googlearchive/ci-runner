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

var _       = require('lodash');
var os      = require('os');
var xoauth2 = require('xoauth2');

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


  this.email = {
    // The From: string to use when sending notification emails.
    sender: env.NOTIFICATION_SENDER,
    // Nodemailer configuration.
    // https://github.com/andris9/nodemailer
    // https://github.com/andris9/nodemailer-smtp-transport
    nodemailer: {
      // TODO(nevir): More than just gmail.
      service: 'gmail',
      auth: {
        xoauth2: xoauth2.createXOAuth2Generator({
          // The Google user to send notification emails from.
          user: env.XOAUTH_USER,
          // The OAuth client ID to authenticate as.
          clientId: env.XOAUTH_CLIENT_ID,
          // The OAuth client secret to authenticate with.
          clientSecret: env.XOAUTH_CLIENT_SECRET,
          // The XOauth refresh token to authorize with.
          refreshToken: env.XOAUTH_REFRESH_TOKEN,
        }),
      },
    },
  };
};

module.exports = Config;
