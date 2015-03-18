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

var async        = require('async');
var chalk        = require('chalk');
var Firebase     = require('firebase');
var GitHub       = require('github');
var htmlToText   = require('nodemailer-html-to-text').htmlToText;
var http         = require('http');
var nodemailer   = require('nodemailer');
var path         = require('path');

var Config       = require('./lib/config');
var Log          = require('./lib/log');
var protect      = require('./lib/protect');
var Queue        = require('./lib/queue');
var RepoRegistry = require('./lib/reporegistry');
var serverSteps  = require('./lib/serversteps');
var TestRunner   = require('./lib/testrunner');

// Setup & Global State

// We may not be in a real TTY, but we _really_ like colors.
chalk.enabled = true;
// We open a crap ton of concurrent requests to Sauce.
http.globalAgent.maxSockets = 250;

// CI Runner configuration.
var config = new Config(process.env);
// The root firebase key that CI runner state is maintained under.
var fbRoot = new Firebase(config.firebase.root);
// The task `Queue` that drives this server.
var queue;
// GitHub API.
var github = new GitHub({version: '3.0.0'});
github.authenticate({type: 'oauth', token: config.github.oauthToken});
// This worker's global log (events not related to tests).
var workerKey = config.worker.workerId.replace(/[.#$\[\]]/g, '-');
var workerLog = new Log(process.stdout, null, fbRoot.child('log').child(workerKey));
// Mailer
var mailer = nodemailer.createTransport(config.email.nodemailer);
mailer.use('compile', htmlToText());
mailer.use('compile', function(mail, done) {
  mail.data.from = config.email.sender;
  mail.data.bcc  = config.email.recipients;
  done();
});

// Workflow Segments

function connectToServices(done) {
  workerLog.group('Connecting to services');

  async.parallel([
    serverSteps.establishSauceTunnel.bind(serverSteps, config, workerLog),
    function(next) {
      fbRoot.authWithCustomToken(config.firebase.secret, function(error) {
        if (!error) {
          workerLog.info('Authenticated with Firebase');
        }
        next(error);
      });
    },
  ], function(error) {
    workerLog.groupEnd();
    done(error);
  });
}

// TODO(nevir): This could use some cleanup.
function startQueue(done) {
  workerLog.info('Starting Queue');

  var repos = new RepoRegistry(path.join(__dirname, 'commits'));

  function processor(commit, done) {
    // TODO(nevir): synchronize status output too!
    var fbStatus = fbRoot.child('status').child(commit.key);
    var log      = new Log(process.stdout, commit, fbStatus.child('log'));
    var runner   = new TestRunner(commit, fbStatus, github, repos, config, mailer, log);
    protect(function() {
      runner.run(done);
    }, function(error) {
      log.fatal(error, 'CI runner internal error:');
      runner.setCommitStatus('error', 'Internal Error');
      done(error);
    });
  }

  queue = new Queue(processor, fbRoot.child('queue'), config);
  queue.start();

  done();
}

function updateRunnersAfterInterval() {
  setTimeout(function() {
    queue.pause(function() {
      TestRunner.update(config, workerLog, mailer, function() {
        queue.resume();
        updateRunnersAfterInterval();
      });
    });
  }, config.worker.runnerRefreshInterval);
}

// Boot

async.series([
  connectToServices,
  TestRunner.update.bind(TestRunner, config, workerLog, mailer),
  startQueue,
  function(done) {
    serverSteps.startServer(config, workerLog, queue, fbRoot, github, done);
  },
], function(error) {
  if (error) {
    workerLog.error('CI Runner failed to start:', error);
    throw error;
  }
  workerLog.info('CI Runner active.');
  updateRunnersAfterInterval();
});

